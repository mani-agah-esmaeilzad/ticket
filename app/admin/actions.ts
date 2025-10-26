'use server';

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import {
  approveOrder,
  rejectOrder,
  seedSeats
} from "@/lib/db";
import {
  createAdminSession,
  destroyAdminSession,
  isAdminAuthenticated,
  validateAdminPassword
} from "@/lib/adminAuth";

function parseNumberField(value: FormDataEntryValue | null, options: { min?: number } = {}): number {
  if (value === null) {
    throw new Error("Missing numeric field");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid numeric field");
  }
  if (options.min !== undefined && parsed < options.min) {
    throw new Error("Numeric field below minimum");
  }
  return parsed;
}

export async function loginAction(formData: FormData): Promise<void> {
  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0) {
    redirect("/admin/login?error=1");
  }
  if (!validateAdminPassword(password)) {
    redirect("/admin/login?error=1");
  }
  createAdminSession();
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  destroyAdminSession();
  redirect("/admin/login");
}

export async function createShowAction(formData: FormData): Promise<void> {
  if (!isAdminAuthenticated()) {
    redirect("/admin/login");
  }

  const title = formData.get("title");
  const startsAtRaw = formData.get("startsAt");
  const rows = parseNumberField(formData.get("rows"), { min: 1 });
  const cols = parseNumberField(formData.get("cols"), { min: 1 });
  const price = parseNumberField(formData.get("price"), { min: 0 });

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("عنوان نمایش الزامی است");
  }
  if (typeof startsAtRaw !== "string" || startsAtRaw.length === 0) {
    throw new Error("تاریخ اجرا الزامی است");
  }

  const startsAt = new Date(startsAtRaw);
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("تاریخ اجرا نامعتبر است");
  }

  const show = await prisma.show.create({
    data: {
      title: title.trim(),
      startsAt,
      rows,
      cols,
      price
    }
  });
  await seedSeats(show.id, rows, cols);

  revalidatePath("/admin");
}

export async function updateShowSettingsAction(formData: FormData): Promise<void> {
  if (!isAdminAuthenticated()) {
    redirect("/admin/login");
  }

  const showId = parseNumberField(formData.get("showId"), { min: 1 });
  const price = parseNumberField(formData.get("price"), { min: 0 });

  await prisma.show.update({
    where: { id: showId },
    data: { price }
  });

  revalidatePath("/admin");
}

export async function approveOrderAction(formData: FormData): Promise<void> {
  if (!isAdminAuthenticated()) {
    redirect("/admin/login");
  }
  const orderId = parseNumberField(formData.get("orderId"), { min: 1 });
  await approveOrder(orderId, "admin-dashboard");
  revalidatePath("/admin");
}

export async function rejectOrderAction(formData: FormData): Promise<void> {
  if (!isAdminAuthenticated()) {
    redirect("/admin/login");
  }
  const orderId = parseNumberField(formData.get("orderId"), { min: 1 });
  await rejectOrder(orderId, "admin-dashboard");
  revalidatePath("/admin");
}
