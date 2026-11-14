import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { send } from "../api/client";
import type { AuthResponse } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useServerAwake, WakingBanner } from "../components/ServerStatus";
import { Button, Card, ErrorBox, Field, Input, Logo } from "../components/ui";

function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = useServerAwake();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // only same-site paths, never an absolute URL from the query string
  const next = params.get("next")?.startsWith("/") && !params.get("next")?.startsWith("//") ? params.get("next")! : "/quadros";
  if (user) return <Navigate to={next} replace />;

  const isLogin = mode === "login";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = isLogin ? { email: form.email, password: form.password } : form;
      const r = await send<AuthResponse>("POST", `/api/auth/${isLogin ? "login" : "register"}`, body);
      signIn(r.token, r.user);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const otherLink = `${isLogin ? "/cadastro" : "/entrar"}${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="min-h-screen">
      {status === "waking" && <WakingBanner />}
      <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-12">
        <Link to="/" className="self-center">
          <Logo />
        </Link>
        <Card>
          <h1 className="mb-4 text-xl font-semibold">{isLogin ? "Entrar" : "Criar conta"}</h1>
          <form onSubmit={submit} className="space-y-4">
            {!isLogin && (
              <Field label="Nome">
                <Input value={form.name} onChange={set("name")} required maxLength={60} autoComplete="name" />
              </Field>
            )}
            <Field label="E-mail">
              <Input type="email" value={form.email} onChange={set("email")} required autoComplete="email" />
            </Field>
            <Field label="Senha">
              <Input
                type="password"
                value={form.password}
                onChange={set("password")}
                required
                minLength={isLogin ? undefined : 8}
                maxLength={72}
                autoComplete={isLogin ? "current-password" : "new-password"}
              />
            </Field>
            <ErrorBox error={error} />
            <Button type="submit" className="w-full" disabled={busy || status === "waking"}>
              {busy ? "Aguarde…" : isLogin ? "Entrar" : "Criar conta"}
            </Button>
          </form>
        </Card>
        <p className="text-center text-sm text-slate-600">
          {isLogin ? "Ainda não tem conta? " : "Já tem conta? "}
          <Link to={otherLink} className="font-medium text-indigo-600 hover:underline">
            {isLogin ? "Criar conta" : "Entrar"}
          </Link>
        </p>
      </div>
    </div>
  );
}

export const LoginPage = () => <AuthForm mode="login" />;
export const RegisterPage = () => <AuthForm mode="register" />;
