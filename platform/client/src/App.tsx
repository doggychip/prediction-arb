import React, { useState, useEffect } from "react";
import { getToken, setToken } from "./lib/api";
import Navbar from "./components/Navbar";
import HomePage from "./pages/HomePage";
import AgentDetailPage from "./pages/AgentDetailPage";
import DashboardPage from "./pages/DashboardPage";
import PublishPage from "./pages/PublishPage";
import LoginPage from "./pages/LoginPage";

type Page =
  | { name: "home" }
  | { name: "agent"; slug: string }
  | { name: "dashboard" }
  | { name: "publish" }
  | { name: "login" };

export default function App() {
  const [page, setPage] = useState<Page>({ name: "home" });
  const [user, setUser] = useState<{ id: string; name: string; email: string } | null>(null);

  useEffect(() => {
    // Restore user from localStorage
    const stored = localStorage.getItem("user");
    if (stored && getToken()) {
      setUser(JSON.parse(stored));
    }
  }, []);

  function handleLogin(userData: { id: string; name: string; email: string }, token: string) {
    setToken(token);
    setUser(userData);
    localStorage.setItem("user", JSON.stringify(userData));
    setPage({ name: "home" });
  }

  function handleLogout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem("user");
    setPage({ name: "home" });
  }

  function navigate(p: Page) {
    setPage(p);
    window.scrollTo(0, 0);
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <Navbar user={user} onNavigate={navigate} onLogout={handleLogout} />
      <main className="max-w-6xl mx-auto px-4 py-8">
        {page.name === "home" && (
          <HomePage onNavigate={navigate} />
        )}
        {page.name === "agent" && (
          <AgentDetailPage slug={page.slug} user={user} onNavigate={navigate} />
        )}
        {page.name === "dashboard" && user && (
          <DashboardPage user={user} onNavigate={navigate} />
        )}
        {page.name === "publish" && user && (
          <PublishPage onNavigate={navigate} />
        )}
        {page.name === "login" && (
          <LoginPage onLogin={handleLogin} />
        )}
        {(page.name === "dashboard" || page.name === "publish") && !user && (
          <LoginPage onLogin={handleLogin} />
        )}
      </main>
    </div>
  );
}
