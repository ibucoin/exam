import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { api, errorMessage } from "../lib/api";

export function PasswordPage() {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const changePassword = useMutation({
    mutationFn: () =>
      api<void>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    onSuccess: () => queryClient.clear(),
  });

  return (
    <section className="narrow-page">
      <div className="settings-section">
        <div className="section-heading">
          <KeyRound aria-hidden="true" />
          <div>
            <h1>修改密码</h1>
            <p>修改后所有设备需要重新登录</p>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (newPassword !== confirmPassword) {
              setLocalError("两次输入的新密码不一致");
              return;
            }
            setLocalError("");
            changePassword.mutate();
          }}
        >
          <label className="field">
            <span>当前密码</span>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>新密码</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>确认新密码</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </label>
          {(localError || changePassword.isError) && (
            <p className="form-error">
              {localError || errorMessage(changePassword.error)}
            </p>
          )}
          <button className="primary-button" type="submit" disabled={changePassword.isPending}>
            {changePassword.isPending ? "正在修改..." : "修改密码"}
          </button>
        </form>
      </div>
    </section>
  );
}
