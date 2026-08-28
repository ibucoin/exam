import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, ShieldCheck, UserCheck, UserX } from "lucide-react";
import type { AdminUser } from "../../shared/types";
import { Loading } from "../components/Loading";
import { api, errorMessage } from "../lib/api";

function userStatus(user: AdminUser) {
  if (user.role === "admin") return "管理员";
  if (user.isDisabled) return "已禁用";
  return "正常";
}

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<AdminUser[]>("/admin/users") });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-users"] });
  const createUser = useMutation({
    mutationFn: () => api<{ id: number }>("/admin/users", { method: "POST", body: JSON.stringify({ username, password }) }),
    onSuccess: () => { setUsername(""); setPassword(""); void refresh(); },
  });
  const setStatus = useMutation({
    mutationFn: ({ id, isDisabled }: { id: number; isDisabled: boolean }) =>
      api<void>(`/admin/users/${id}/status`, { method: "PATCH", body: JSON.stringify({ isDisabled }) }),
    onSuccess: () => void refresh(),
  });
  const reset = useMutation({
    mutationFn: () => api<void>(`/admin/users/${resetUserId}/reset-password`, { method: "POST", body: JSON.stringify({ password: resetPassword }) }),
    onSuccess: () => { setResetUserId(null); setResetPassword(""); void refresh(); },
  });

  return (
    <div className="admin-page">
      <header className="page-heading"><div><p className="eyebrow">管理员</p><h1>用户管理</h1></div></header>
      <section className="admin-create">
        <div className="section-heading"><Plus /><div><h2>创建用户</h2><p>设置用户的登录账号和初始密码</p></div></div>
        <form onSubmit={(event) => { event.preventDefault(); createUser.mutate(); }}>
          <label className="field"><span>用户名</span><input value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
          <label className="field"><span>初始密码</span><input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button className="primary-button" type="submit" disabled={createUser.isPending}><Plus />创建用户</button>
        </form>
        {createUser.isError && <p className="form-error">{errorMessage(createUser.error)}</p>}
      </section>

      <section className="user-section">
        <h2>账号列表</h2>
        {users.isPending ? <Loading /> : users.isError ? <p className="page-error">{errorMessage(users.error)}</p> : (
          <div className="user-list">
            {users.data.map((user) => (
              <article className="user-row" key={user.id}>
                <div className="user-identity">
                  <span className={`user-avatar ${user.isDisabled ? "disabled" : ""}`}>{user.username.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{user.username}</strong><span>{userStatus(user)}</span></div>
                  {user.role === "admin" && <ShieldCheck className="admin-mark" aria-label="管理员" />}
                </div>
                <div className="user-actions">
                  <button className="secondary-button" type="button" onClick={() => { setResetUserId(user.id); setResetPassword(""); }}><KeyRound />重置密码</button>
                  {user.role !== "admin" && (
                    <button
                      className={user.isDisabled ? "success-button" : "danger-button"}
                      type="button"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: user.id, isDisabled: !user.isDisabled })}
                    >
                      {user.isDisabled ? <UserCheck /> : <UserX />}{user.isDisabled ? "启用" : "禁用"}
                    </button>
                  )}
                </div>
                {resetUserId === user.id && (
                  <form className="reset-form" onSubmit={(event) => { event.preventDefault(); reset.mutate(); }}>
                    <label className="field"><span>新的初始密码</span><input type="password" minLength={8} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required autoFocus /></label>
                    <button className="primary-button" type="submit" disabled={reset.isPending}>确认重置</button>
                    <button className="text-button" type="button" onClick={() => setResetUserId(null)}>取消</button>
                    {reset.isError && <span className="form-error">{errorMessage(reset.error)}</span>}
                  </form>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
