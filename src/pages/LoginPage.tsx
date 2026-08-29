import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import type { CurrentUser } from "../../shared/types";
import { api, errorMessage } from "../lib/api";

export function LoginPage() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () =>
      api<CurrentUser>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
    onSuccess: (user) => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "me",
      });
      queryClient.setQueryData(["me"], user);
    },
  });

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="login-title">
        <div className="auth-brand">
          <ShieldCheck aria-hidden="true" />
          <span>药考复习</span>
        </div>
        <div>
          <h1 id="login-title">登录</h1>
          <p>进入你的个人复习空间</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            login.mutate();
          }}
        >
          <label className="field">
            <span>用户名</span>
            <span className="input-with-icon">
              <UserRound aria-hidden="true" />
              <input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoFocus
              />
            </span>
          </label>
          <label className="field">
            <span>密码</span>
            <span className="input-with-icon">
              <LockKeyhole aria-hidden="true" />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </span>
          </label>
          {login.isError && <p className="form-error">{errorMessage(login.error)}</p>}
          <button className="primary-button full-width" type="submit" disabled={login.isPending}>
            {login.isPending ? "登录中..." : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}
