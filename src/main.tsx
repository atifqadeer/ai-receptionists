import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import LoginPage from "./components/LoginPage";
import { authApi, getSession, installFetchAuth, clearSession, AuthUser } from "./utils/auth";

// Every dashboard API request carries the sign-in token.
installFetchAuth();

// The dashboard only after signing in; the login page otherwise.
function AuthGate() {
  const [user, setUser] = useState<AuthUser | null | undefined>(getSession() ? undefined : null);

  useEffect(() => {
    // A saved token: check it is still valid (expired, or the account removed).
    if (user === undefined) {
      authApi.me().then((u) => {
        if (!u) clearSession();
        setUser(u);
      }).catch(() => setUser(getSession()?.user ?? null));
    }
    const out = () => setUser(null);
    window.addEventListener("auth-signed-out", out);
    return () => window.removeEventListener("auth-signed-out", out);
  }, []);

  if (user === undefined) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400 text-sm">
        <i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…
      </div>
    );
  }
  return user ? <App user={user} /> : <LoginPage onSignedIn={setUser} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<AuthGate />);
