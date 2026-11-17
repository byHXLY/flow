"use client";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
const titles: Record<string, string> = { "/market": "Товары", "/sources": "Источники", "/sellers": "Продавцы", "/settings": "Настройки" };
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname(), { resolvedTheme, setTheme } = useTheme();
  return <SidebarProvider><AppSidebar /><SidebarInset>
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" aria-label="Свернуть меню" /><Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb><BreadcrumbList>{path !== "/settings" && <><BreadcrumbItem className="hidden sm:block">Рынок</BreadcrumbItem><BreadcrumbSeparator className="hidden sm:block" /></>}<BreadcrumbItem><BreadcrumbPage>{titles[path] || "Панель"}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
      <Button variant="ghost" size="icon" className="ml-auto" aria-label="Сменить тему" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}><Sun className="dark:hidden" /><Moon className="hidden dark:block" /></Button>
    </header>
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
  </SidebarInset></SidebarProvider>;
}
