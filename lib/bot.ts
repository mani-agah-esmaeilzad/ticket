import { Bot, InlineKeyboard } from "grammy";
import {
  approveOrder,
  clearUserState,
  createOrder,
  ensureSchema,
  freezeHeldSeats,
  getOrder,
  getShow,
  getUserState,
  heldSeats,
  listShows,
  rejectOrder,
  seatStatusMap,
  setUserState,
  toggleSeat
} from "./db";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not defined in environment variables");
}

const ADMINS = (process.env.ADMINS ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const HOLD_MINUTES = Number(process.env.HOLD_MINUTES ?? "10");

const bot = new Bot(BOT_TOKEN);

bot.use(async (ctx, next) => {
  await ensureSchema();
  await next();
});

bot.command("start", async (ctx) => {
  await ctx.reply("سلام 👋 به ربات فروش بلیت خوش اومدی!\nبرای شروع دستور /buy رو بزن.");
});

bot.command("buy", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    return;
  }

  const shows = await listShows();
  if (shows.length === 0) {
    await ctx.reply("در حال حاضر نمایشی ثبت نشده است.");
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const show of shows) {
    const label = `${show.title} (${show.starts_at.slice(0, 16).replace('T', ' ')})`;
    keyboard.text(label, `show:${show.id}`).row();
  }

  await setUserState({
    user_id: String(userId),
    state: "picking_show",
    show_id: null,
    seats: null,
    total: null
  });

  await ctx.reply("نمایش مورد نظر رو انتخاب کن:", {
    reply_markup: keyboard
  });
});

bot.callbackQuery(/^show:(\d+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.answerCallbackQuery();
    return;
  }

  const showId = Number(ctx.match[1]);
  const show = await getShow(showId);
  if (!show) {
    await ctx.answerCallbackQuery({ text: "نمایش پیدا نشد", show_alert: true });
    return;
  }

  const keyboard = await buildSeatsKeyboard(showId, show.rows, show.cols);

  await setUserState({
    user_id: String(userId),
    state: "picking_seats",
    show_id: showId,
    seats: null,
    total: null
  });

  if (ctx.callbackQuery.message) {
    await ctx.editMessageText("صندلی‌هات رو انتخاب کن:", {
      reply_markup: keyboard
    });
  }

  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^togseat:(\d+):([A-Z]\d+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.answerCallbackQuery();
    return;
  }

  const showId = Number(ctx.match[1]);
  const seatCode = ctx.match[2];

  const result = await toggleSeat(showId, seatCode, String(userId), HOLD_MINUTES);
  if (result === "sold") {
    await ctx.answerCallbackQuery({ text: "این صندلی فروخته شده ❌", show_alert: true });
    return;
  }
  if (result === "held-by-other") {
    await ctx.answerCallbackQuery({ text: "صندلی توسط فرد دیگری رزرو شده ⏳", show_alert: true });
    return;
  }

  const show = await getShow(showId);
  if (!show) {
    await ctx.answerCallbackQuery({ text: "نمایش پیدا نشد", show_alert: true });
    return;
  }

  const keyboard = await buildSeatsKeyboard(showId, show.rows, show.cols);
  if (ctx.callbackQuery.message) {
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  }

  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^confirm:(\d+)$/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.answerCallbackQuery();
    return;
  }

  const showId = Number(ctx.match[1]);
  const seats = await heldSeats(showId, String(userId));
  if (seats.length === 0) {
    await ctx.answerCallbackQuery({ text: "هیچ صندلی انتخاب نشده.", show_alert: true });
    return;
  }

  const show = await getShow(showId);
  if (!show) {
    await ctx.answerCallbackQuery({ text: "نمایش پیدا نشد", show_alert: true });
    return;
  }

  const total = show.price * seats.length;
  await freezeHeldSeats(showId, String(userId));
  await setUserState({
    user_id: String(userId),
    state: "waiting_receipt",
    show_id: showId,
    seats,
    total
  });

  if (ctx.callbackQuery.message) {
    await ctx.editMessageText(
      `🎭 ${show.title}\nصندلی‌ها: ${seats.join(", ")}\nمبلغ کل: ${total.toLocaleString("fa-IR")} تومان\n\n` +
        "💳 لطفاً مبلغ را به شماره کارت زیر واریز کنید:\n" +
        "💰 <b>6219-8610-1234-5678</b>\n" +
        "به نام: مانی آگاه\n\n" +
        "سپس عکس یا شماره پیگیری پرداخت را ارسال کنید.",
      { parse_mode: "HTML" }
    );
  }

  await ctx.answerCallbackQuery();
});

bot.on("message", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    return;
  }

  const state = await getUserState(String(userId));
  if (!state || state.state !== "waiting_receipt" || !state.show_id || !state.seats || !state.total) {
    return;
  }

  const receipt = ctx.message?.photo?.length
    ? { type: "photo" as const, ref: ctx.message.photo[ctx.message.photo.length - 1].file_id }
    : ctx.message?.text
    ? { type: "text" as const, ref: ctx.message.text }
    : null;

  if (!receipt) {
    await ctx.reply("لطفاً عکس یا متن رسید را ارسال کن.");
    return;
  }

  const orderId = await createOrder({
    userId: String(userId),
    showId: state.show_id,
    seats: state.seats,
    amount: state.total,
    receiptType: receipt.type,
    receiptRef: receipt.ref
  });

  await ctx.reply("✅ رسیدت ثبت شد و برای مدیر ارسال شد. منتظر تأیید باش.");

  const baseText =
    `💰 پرداخت جدید:\n` +
    `کاربر: ${ctx.from?.first_name ?? "کاربر"}\n` +
    `مبلغ: ${state.total.toLocaleString("fa-IR")} تومان\n` +
    `صندلی‌ها: ${state.seats.join(", ")}`;

  const adminKeyboard = new InlineKeyboard().text("✅ تأیید", `approve:${orderId}`).text("❌ رد", `reject:${orderId}`).row();

  await Promise.all(
    ADMINS.map(async (adminId) => {
      if (receipt.type === "photo") {
        await ctx.api.sendPhoto(Number(adminId), receipt.ref, {
          caption: baseText,
          reply_markup: adminKeyboard
        });
      } else {
        await ctx.api.sendMessage(Number(adminId), `${baseText}\nمتن رسید: ${receipt.ref}`, {
          reply_markup: adminKeyboard
        });
      }
    })
  );

  await clearUserState(String(userId));
});

bot.callbackQuery(/^approve:(\d+)$/, async (ctx) => {
  const adminId = ctx.from?.id;
  if (!adminId) {
    await ctx.answerCallbackQuery();
    return;
  }
  const orderId = Number(ctx.match[1]);
  const order = await approveOrder(orderId, String(adminId));
  if (!order) {
    await ctx.answerCallbackQuery({ text: "سفارش پیدا نشد", show_alert: true });
    return;
  }
  if (order.status !== "approved") {
    await ctx.answerCallbackQuery({ text: "این سفارش قبلاً رسیدگی شده است", show_alert: true });
    return;
  }

  const ticketNo = `${order.show_id}-${order.user_id}-${Date.now() % 10000}`;
  await ctx.api.sendMessage(Number(order.user_id), `🎫 پرداخت تأیید شد! شماره بلیت: <b>${ticketNo}</b>`, {
    parse_mode: "HTML"
  });
  await ctx.answerCallbackQuery({ text: "تأیید شد ✅", show_alert: true });
});

bot.callbackQuery(/^reject:(\d+)$/, async (ctx) => {
  const adminId = ctx.from?.id;
  if (!adminId) {
    await ctx.answerCallbackQuery();
    return;
  }
  const orderId = Number(ctx.match[1]);
  const order = await rejectOrder(orderId, String(adminId));
  if (!order) {
    await ctx.answerCallbackQuery({ text: "سفارش پیدا نشد", show_alert: true });
    return;
  }
  if (order.status !== "rejected") {
    await ctx.answerCallbackQuery({ text: "این سفارش قبلاً رسیدگی شده است", show_alert: true });
    return;
  }

  await ctx.api.sendMessage(Number(order.user_id), "❌ رسید پرداخت تأیید نشد. لطفاً بررسی و مجدداً ارسال کن.");
  await ctx.answerCallbackQuery({ text: "رد شد ❌", show_alert: true });
});

bot.catch((err) => {
  console.error("Grammy error", err);
});

export type TelegramBot = typeof bot;
export const telegramBot = bot;

export async function handleUpdate(request: Request): Promise<Response> {
  try {
    const update = await request.json();
    await bot.handleUpdate(update);
    return new Response("OK");
  } catch (error) {
    console.error("Failed to handle Telegram update", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

async function buildSeatsKeyboard(showId: number, rows: number, cols: number) {
  const statusMap = await seatStatusMap(showId);
  const keyboard = new InlineKeyboard();
  for (const row of "ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, rows)) {
    for (let col = 1; col <= cols; col += 1) {
      const code = `${row}${col}`;
      const seat = statusMap[code];
      const status = seat?.status ?? "available";
      const emoji = status === "available" ? "🟩" : status === "held" ? "🟨" : "🟥";
      keyboard.text(`${emoji}${code}`, `togseat:${showId}:${code}`);
    }
    keyboard.row();
  }
  keyboard.text("✅ ادامه", `confirm:${showId}`);
  return keyboard;
}
