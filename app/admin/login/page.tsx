import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { loginAction } from "../actions";

export const dynamic = "force-dynamic";

type AdminLoginPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function AdminLoginPage({ searchParams }: AdminLoginPageProps) {
  if (isAdminAuthenticated()) {
    redirect("/admin");
  }

  const hasError = searchParams?.error === "1";

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f4f5" }}>
      <form
        action={loginAction}
        style={{
          width: "320px",
          padding: "2rem",
          borderRadius: "12px",
          background: "#ffffff",
          boxShadow: "0 15px 40px rgba(15, 23, 42, 0.1)",
          display: "flex",
          flexDirection: "column",
          gap: "1.2rem"
        }}
      >
        <h1 style={{ margin: 0, textAlign: "center", fontSize: "1.4rem" }}>ورود مدیر</h1>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#475569" }}>برای ورود، رمز مدیر را وارد کنید.</p>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.95rem" }}>
          رمز عبور
          <input
            name="password"
            type="password"
            required
            placeholder="رمز مدیر"
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "0.8rem",
              fontSize: "1rem"
            }}
          />
        </label>
        {hasError ? (
          <div style={{ color: "#dc2626", fontSize: "0.85rem", textAlign: "center" }}>رمز وارد شده نادرست است.</div>
        ) : null}
        <button
          type="submit"
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "0.8rem",
            fontSize: "1rem",
            cursor: "pointer",
            transition: "background 0.2s ease"
          }}
        >
          ورود
        </button>
      </form>
    </main>
  );
}
