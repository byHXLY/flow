"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Command, Settings2, ShoppingBag } from "lucide-react";
import { NavMain } from "@/components/nav-main";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  return <Sidebar collapsible="icon" {...props}>
    <SidebarHeader><SidebarMenu><SidebarMenuItem>
      <SidebarMenuButton size="lg" render={<Link href="/market" />}>
        <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><Command className="size-4" /></div>
        <span className="font-semibold">Панель</span>
      </SidebarMenuButton>
    </SidebarMenuItem></SidebarMenu></SidebarHeader>
    <SidebarContent><NavMain items={[{ title: "Рынок", url: "/market", icon: <ShoppingBag />, isActive: true,
      items: [{ title: "Товары", url: "/market" }, { title: "Продавцы", url: "/sellers" }, { title: "Источники", url: "/sources" }],
    }]} /></SidebarContent>
    <SidebarFooter><SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip="Настройки" isActive={pathname === "/settings"} render={<Link href="/settings" />}><Settings2 /><span>Настройки</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter>
    <SidebarRail />
  </Sidebar>;
}
