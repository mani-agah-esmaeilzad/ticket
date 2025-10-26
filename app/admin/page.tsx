import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminAuth";
import {
  approveOrderAction,
  createShowAction,
  logoutAction,
  rejectOrderAction,
  updateShowSettingsAction
} from "./actions";

export const dynamic = "force-dynamic";

type SeatStats = {
  available: number;
  held: number;
  sold: number;
};

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("fa-IR").format(amount);
}

export default async function AdminDashboardPage(): Promise<JSX.Element> {
  await requireAdmin();

  const [shows, seatGroups, orders] = await Promise.all([
    prisma.show.findMany({
      orderBy: { startsAt: "asc" }
    }),
    prisma.seat.groupBy({
      by: ["showId", "status"],
      _count: { _all: true }
    }),
    prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      include: { show: true },
      take: 50
    })
  ]);

  const seatStatsByShow = new Map<number, SeatStats>();
  for (const group of seatGroups) {
    const stats = seatStatsByShow.get(group.showId) ?? { available: 0, held: 0, sold: 0 };
    if (group.status === "available") {
      stats.available = group._count._all;
    } else if (group.status === "held") {
      stats.held = group._count._all;
    } else if (group.status === "sold") {
      stats.sold = group._count._all;
    }
    seatStatsByShow.set(group.showId, stats);
  }

  const pendingOrders = orders.filter((order) => order.status === "pending");
  const approvedCount = orders.filter((order) => order.status === "approved").length;
  const rejectedCount = orders.filter((order) => order.status === "rejected").length;

  return (
    <main style={{ padding: "2rem", background: "#f8fafc", minHeight: "100vh", fontFamily: "IranSans, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.8rem" }}>داشبورد مدیریت</h1>
          <p style={{ margin: 0, color: "#64748b" }}>مدیریت نمایش‌ها و سفارش‌ها</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            style={{
              background: "#ef4444",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              padding: "0.7rem 1.4rem",
              cursor: "pointer"
            }}
          >
            خروج
          </button>
        </form>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem"
        }}
      >
        <DashboardCard title="نمایش‌ها" value={shows.length.toString()} color="#2563eb" />
        <DashboardCard title="سفارش‌های در انتظار" value={pendingOrders.length.toString()} color="#f59e0b" />
        <DashboardCard title="سفارش‌های تأیید شده" value={approvedCount.toString()} color="#16a34a" />
        <DashboardCard title="سفارش‌های رد شده" value={rejectedCount.toString()} color="#dc2626" />
      </section>

      <section style={{ display: "grid", gap: "2rem", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <div
          style={{
            background: "#fff",
            borderRadius: "16px",
            padding: "1.5rem",
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
            display: "flex",
            flexDirection: "column",
            gap: "1.2rem"
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.3rem" }}>افزودن نمایش جدید</h2>
          <form action={createShowAction} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              عنوان نمایش
              <input
                name="title"
                required
                placeholder="مثال: تئاتر شبانه"
                style={{ padding: "0.7rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              زمان اجرا
              <input
                name="startsAt"
                type="datetime-local"
                required
                style={{ padding: "0.7rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}
              />
            </label>
            <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                ردیف‌ها
                <input
                  name="rows"
                  type="number"
                  min={1}
                  required
                  defaultValue={6}
                  style={{ padding: "0.7rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                ستون‌ها
                <input
                  name="cols"
                  type="number"
                  min={1}
                  required
                  defaultValue={10}
                  style={{ padding: "0.7rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                قیمت (تومان)
                <input
                  name="price"
                  type="number"
                  min={0}
                  required
                  defaultValue={250000}
                  style={{ padding: "0.7rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}
                />
              </label>
            </div>
            <button
              type="submit"
              style={{
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                padding: "0.8rem",
                cursor: "pointer"
              }}
            >
              ذخیره نمایش
            </button>
          </form>
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: "16px",
            padding: "1.5rem",
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
            display: "flex",
            flexDirection: "column",
            gap: "1rem"
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.3rem" }}>سفارش‌های در انتظار</h2>
          {pendingOrders.length === 0 ? (
            <p style={{ margin: 0, color: "#64748b" }}>سفارش در انتظاری ثبت نشده است.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {pendingOrders.map((order) => (
                <div
                  key={order.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "12px",
                    padding: "1rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.6rem"
                  }}
                >
                  <strong>سفارش #{order.id}</strong>
                  <div>کاربر: {order.userId}</div>
                  <div>نمایش: {order.show?.title ?? "نامشخص"}</div>
                  <div>صندلی‌ها: {order.seats}</div>
                  <div>مبلغ: {formatCurrency(order.amount)} تومان</div>
                  <div>ثبت شده در: {formatDateTime(order.createdAt)}</div>
                  <div style={{ display: "flex", gap: "0.6rem" }}>
                    <form action={approveOrderAction}>
                      <input type="hidden" name="orderId" value={order.id} />
                      <button
                        type="submit"
                        style={{
                          background: "#16a34a",
                          color: "#fff",
                          border: "none",
                          borderRadius: "8px",
                          padding: "0.5rem 1rem",
                          cursor: "pointer"
                        }}
                      >
                        تأیید
                      </button>
                    </form>
                    <form action={rejectOrderAction}>
                      <input type="hidden" name="orderId" value={order.id} />
                      <button
                        type="submit"
                        style={{
                          background: "#dc2626",
                          color: "#fff",
                          border: "none",
                          borderRadius: "8px",
                          padding: "0.5rem 1rem",
                          cursor: "pointer"
                        }}
                      >
                        رد
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section
        style={{
          marginTop: "2rem",
          background: "#fff",
          borderRadius: "16px",
          padding: "1.5rem",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)"
        }}
      >
        <h2 style={{ marginTop: 0 }}>لیست نمایش‌ها</h2>
        {shows.length === 0 ? (
          <p style={{ margin: 0, color: "#64748b" }}>نمایشی ثبت نشده است.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {shows.map((show) => {
              const stats = seatStatsByShow.get(show.id) ?? { available: 0, held: 0, sold: 0 };
              return (
                <div
                  key={show.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "12px",
                    padding: "1rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.6rem"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: "1.1rem" }}>{show.title}</h3>
                      <p style={{ margin: 0, color: "#475569", fontSize: "0.9rem" }}>{formatDateTime(show.startsAt)}</p>
                    </div>
                    <div style={{ display: "flex", gap: "0.8rem", fontSize: "0.9rem" }}>
                      <Badge color="#16a34a">🟩 آزاد: {stats.available}</Badge>
                      <Badge color="#f59e0b">🟨 رزرو: {stats.held}</Badge>
                      <Badge color="#ef4444">🟥 فروخته: {stats.sold}</Badge>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                    <form
                      action={updateShowSettingsAction}
                      style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}
                    >
                      <input type="hidden" name="showId" value={show.id} />
                      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        قیمت (تومان):
                        <input
                          name="price"
                          type="number"
                          min={0}
                          defaultValue={show.price}
                          style={{ width: "120px", padding: "0.4rem", borderRadius: "6px", border: "1px solid #d1d5db" }}
                        />
                      </label>
                      <button
                        type="submit"
                        style={{
                          background: "#2563eb",
                          color: "#fff",
                          border: "none",
                          borderRadius: "8px",
                          padding: "0.5rem 1rem",
                          cursor: "pointer"
                        }}
                      >
                        به‌روزرسانی
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section
        style={{
          marginTop: "2rem",
          background: "#fff",
          borderRadius: "16px",
          padding: "1.5rem",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)"
        }}
      >
        <h2 style={{ marginTop: 0 }}>همه سفارش‌ها</h2>
        {orders.length === 0 ? (
          <p style={{ margin: 0, color: "#64748b" }}>سفارشی ثبت نشده است.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem" }}>
            <thead>
              <tr style={{ textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: "0.6rem" }}>#</th>
                <th style={{ padding: "0.6rem" }}>وضعیت</th>
                <th style={{ padding: "0.6rem" }}>نمایش</th>
                <th style={{ padding: "0.6rem" }}>کاربر</th>
                <th style={{ padding: "0.6rem" }}>صندلی‌ها</th>
                <th style={{ padding: "0.6rem" }}>مبلغ</th>
                <th style={{ padding: "0.6rem" }}>زمان</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.6rem" }}>{order.id}</td>
                  <td style={{ padding: "0.6rem" }}>
                    <StatusBadge status={order.status} />
                  </td>
                  <td style={{ padding: "0.6rem" }}>{order.show?.title ?? "نامشخص"}</td>
                  <td style={{ padding: "0.6rem" }}>{order.userId}</td>
                  <td style={{ padding: "0.6rem" }}>{order.seats}</td>
                  <td style={{ padding: "0.6rem" }}>{formatCurrency(order.amount)} تومان</td>
                  <td style={{ padding: "0.6rem" }}>{formatDateTime(order.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

type DashboardCardProps = {
  title: string;
  value: string;
  color: string;
};

function DashboardCard({ title, value, color }: DashboardCardProps): JSX.Element {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "16px",
        padding: "1.5rem",
        boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)"
      }}
    >
      <span style={{ display: "block", color: "#64748b", marginBottom: "0.5rem" }}>{title}</span>
      <strong style={{ fontSize: "1.8rem", color }}>{value}</strong>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: ReactNode }): JSX.Element {
  return (
    <span
      style={{
        background: `${color}1a`,
        color,
        borderRadius: "999px",
        padding: "0.3rem 0.8rem",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem"
      }}
    >
      {children}
    </span>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const normalized = status.toLowerCase();
  if (normalized === "approved") {
    return <Badge color="#16a34a">تأیید شده</Badge>;
  }
  if (normalized === "rejected") {
    return <Badge color="#dc2626">رد شده</Badge>;
  }
  if (normalized === "pending") {
    return <Badge color="#f59e0b">در انتظار</Badge>;
  }
  return <Badge color="#64748b">{status}</Badge>;
}
