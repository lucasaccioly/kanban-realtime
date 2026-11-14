import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { Avatar, Button, Logo } from "./ui";

export function AppHeader({ children }: { children?: ReactNode }) {
  const { user, signOut } = useAuth();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <Link to="/quadros">
          <Logo />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
        {user && (
          <div className="flex items-center gap-2">
            <Avatar id={user.id} name={user.name} />
            <span className="hidden text-sm text-slate-700 sm:inline">{user.isGuest ? "Visitante" : user.name}</span>
            <Button variant="ghost" onClick={signOut} aria-label="Sair" className="px-2">
              <LogOut size={16} />
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
