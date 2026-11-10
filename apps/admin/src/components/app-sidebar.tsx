import type { ComponentProps } from "react";
import { NavLink } from "react-router";
import { IconCirclePlusFilled, IconDatabase, IconInnerShadowTop } from "@tabler/icons-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";

export function AppSidebar({ onAdd, ...props }: ComponentProps<typeof Sidebar> & { onAdd: () => void }) {
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:p-1.5!">
              <NavLink to="/movies" onClick={() => setOpenMobile(false)}>
                <IconInnerShadowTop className="size-5!" />
                <span className="text-base font-semibold">Film Shelf</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              <SidebarMenuItem className="flex items-center gap-2">
                <SidebarMenuButton tooltip="添加影视" className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground" onClick={() => { setOpenMobile(false); onAdd(); }}>
                  <IconCirclePlusFilled />
                  <span>添加影视</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="影视管理" isActive>
                  <NavLink to="/movies" onClick={() => setOpenMobile(false)}><IconDatabase /><span>影视管理</span></NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
