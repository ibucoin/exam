import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { CurrentUser } from "../shared/types";
import { AppShell } from "./components/AppShell";
import { Loading } from "./components/Loading";
import { ApiRequestError, api } from "./lib/api";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { PasswordPage } from "./pages/PasswordPage";
import { PrescriptionPage } from "./pages/PrescriptionPage";
import { ReviewPage } from "./pages/ReviewPage";
import { RoundArchivePage, RoundsPage } from "./pages/RoundsPage";
import { SearchPage } from "./pages/SearchPage";
import { SkillGroupPage, SkillRedirect } from "./pages/SkillGroupPage";

export default function App() {
  const currentUser = useQuery({
    queryKey: ["me"],
    queryFn: () => api<CurrentUser>("/auth/me"),
  });

  if (currentUser.isPending) return <Loading label="正在检查登录状态" />;
  if (currentUser.error instanceof ApiRequestError && currentUser.error.status === 401) {
    return <LoginPage />;
  }
  if (currentUser.isError) {
    return (
      <main className="fatal-state">
        <AlertCircle aria-hidden="true" />
        <h1>暂时无法连接服务</h1>
        <button className="secondary-button" type="button" onClick={() => currentUser.refetch()}>
          重新连接
        </button>
      </main>
    );
  }
  return (
    <Routes>
      <Route element={<AppShell user={currentUser.data} />}>
        <Route index element={<DashboardPage userId={currentUser.data.id} />} />
        <Route path="skills" element={<SkillRedirect userId={currentUser.data.id} />} />
        <Route path="skills/:group" element={<SkillGroupPage />} />
        <Route path="rounds" element={<RoundsPage />} />
        <Route path="rounds/:id" element={<RoundArchivePage />} />
        <Route path="prescriptions" element={<PrescriptionPage />} />
        <Route path="prescriptions/:id" element={<PrescriptionPage />} />
        <Route path="review/:mode" element={<ReviewPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="profile" element={<PasswordPage />} />
        <Route
          path="admin/users"
          element={currentUser.data.role === "admin" ? <AdminUsersPage /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
