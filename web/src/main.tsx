import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router";
import { AuthProvider, RequireAuth } from "./auth/AuthContext";
import "./index.css";
import { LoginPage, RegisterPage } from "./pages/Auth";
import { BoardPage } from "./pages/BoardPage";
import { BoardsPage } from "./pages/Boards";
import { JoinInvitePage } from "./pages/JoinInvite";
import { LandingPage } from "./pages/Landing";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

const router = createBrowserRouter([
  {
    element: (
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    ),
    children: [
      { index: true, element: <LandingPage /> },
      { path: "entrar", element: <LoginPage /> },
      { path: "cadastro", element: <RegisterPage /> },
      { path: "quadros", element: <RequireAuth><BoardsPage /></RequireAuth> },
      { path: "quadros/:id", element: <RequireAuth><BoardPage /></RequireAuth> },
      { path: "convite/:token", element: <RequireAuth><JoinInvitePage /></RequireAuth> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
