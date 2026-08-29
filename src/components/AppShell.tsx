import {
  BookOpen,
  ClipboardCheck,
  Heart,
  Home,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CurrentUser } from "../../shared/types";
import { api } from "../lib/api";

const mainNavigation = [
  { to: "/", label: "首页", icon: Home },
  { to: "/skills", label: "技能题", icon: BookOpen },
  { to: "/prescriptions", label: "处方审核", icon: ClipboardCheck },
  { to: "/review/wrong", label: "错题", icon: TriangleAlert },
  { to: "/review/favorite", label: "收藏", icon: Heart },
  { to: "/search", label: "搜索", icon: Search },
];

export function AppShell({ user }: { user: CurrentUser }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      window.location.replace("/");
    },
  });

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand" to="/" aria-label="药考复习首页">
          <ShieldCheck aria-hidden="true" />
          <span>药考复习</span>
        </NavLink>
        <nav className="desktop-nav" aria-label="主导航">
          {mainNavigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="account-actions">
          {user.role === "admin" && (
            <NavLink className="icon-button" to="/admin/users" title="用户管理">
              <Settings aria-hidden="true" />
              <span className="sr-only">用户管理</span>
            </NavLink>
          )}
          <NavLink className="user-chip" to="/profile">
            {user.username}
          </NavLink>
          <button
            className="icon-button"
            type="button"
            title="退出登录"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut aria-hidden="true" />
            <span className="sr-only">退出登录</span>
          </button>
        </div>
      </header>
      <main className="page-container">
        <Outlet />
      </main>
      <nav className="mobile-nav" aria-label="移动端主导航">
        {mainNavigation.slice(0, 4).concat(mainNavigation[5]).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
