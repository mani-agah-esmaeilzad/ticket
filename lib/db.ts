import { Prisma, SeatStatus } from "@prisma/client";
import { prisma } from "./prisma";

export type ShowRecord = {
  id: number;
  title: string;
  starts_at: string;
  rows: number;
  cols: number;
  price: number;
};

export type SeatRecord = {
  show_id: number;
  seat_code: string;
  status: "available" | "held" | "sold";
  held_by: string | null;
  hold_until: string | null;
  buyer_id: string | null;
};

export type UserStateRecord = {
  user_id: string;
  state: string | null;
  show_id: number | null;
  seats: string[] | null;
  total: number | null;
};

export type OrderRecord = {
  id: number;
  user_id: string;
  show_id: number;
  seats: string[];
  amount: number;
  status: string;
};

let schemaInitialized: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaInitialized) {
    schemaInitialized = (async () => {
      try {
        const showCount = await prisma.show.count();
        if (showCount === 0) {
          const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
          const show = await prisma.show.create({
            data: {
              title: "نمایش تست",
              startsAt,
              rows: 6,
              cols: 10,
              price: 250000
            }
          });
          await seedSeats(show.id, show.rows, show.cols);
        }
      } catch (error) {
        schemaInitialized = null;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
          console.error("Database schema missing. Run `npm run init-db` to create tables.");
        }
        throw error;
      }
    })();
  }
  return schemaInitialized;
}

export async function seedSeats(showId: number, rows: number, cols: number): Promise<void> {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, rows);
  const data = [] as { showId: number; seatCode: string }[];
  for (const letter of letters) {
    for (let col = 1; col <= cols; col += 1) {
      data.push({ showId, seatCode: `${letter}${col}` });
    }
  }
  if (data.length > 0) {
    await prisma.seat.createMany({
      data: data.map((item) => ({ showId: item.showId, seatCode: item.seatCode })),
      skipDuplicates: true
    });
  }
}

export async function listShows(): Promise<ShowRecord[]> {
  const shows = await prisma.show.findMany({ orderBy: { startsAt: "asc" } });
  return shows.map((show) => ({
    id: show.id,
    title: show.title,
    starts_at: show.startsAt.toISOString(),
    rows: show.rows,
    cols: show.cols,
    price: show.price
  }));
}

export async function getShow(showId: number): Promise<ShowRecord | null> {
  const show = await prisma.show.findUnique({ where: { id: showId } });
  if (!show) {
    return null;
  }
  return {
    id: show.id,
    title: show.title,
    starts_at: show.startsAt.toISOString(),
    rows: show.rows,
    cols: show.cols,
    price: show.price
  };
}

export async function releaseExpiredHolds(showId: number): Promise<void> {
  await prisma.seat.updateMany({
    where: {
      showId,
      status: SeatStatus.held,
      holdUntil: { lt: new Date() }
    },
    data: {
      status: SeatStatus.available,
      heldBy: null,
      holdUntil: null
    }
  });
}

export async function seatStatusMap(showId: number): Promise<Record<string, SeatRecord>> {
  await releaseExpiredHolds(showId);
  const seats = await prisma.seat.findMany({ where: { showId } });
  return seats.reduce<Record<string, SeatRecord>>((acc, seat) => {
    acc[seat.seatCode] = {
      show_id: seat.showId,
      seat_code: seat.seatCode,
      status: seat.status,
      held_by: seat.heldBy,
      hold_until: seat.holdUntil ? seat.holdUntil.toISOString() : null,
      buyer_id: seat.buyerId
    };
    return acc;
  }, {});
}

export async function toggleSeat(
  showId: number,
  seatCode: string,
  userId: string,
  holdMinutes: number
): Promise<"sold" | "held" | "available" | "held-by-other"> {
  return prisma.$transaction(async (tx) => {
    await tx.seat.updateMany({
      where: {
        showId,
        seatCode,
        status: SeatStatus.held,
        holdUntil: { lt: new Date() }
      },
      data: {
        status: SeatStatus.available,
        heldBy: null,
        holdUntil: null
      }
    });

    const seat = await tx.seat.findUnique({
      where: { showId_seatCode: { showId, seatCode } }
    });

    if (!seat) {
      throw new Error("Seat not found");
    }

    if (seat.status === SeatStatus.sold) {
      return "sold";
    }
    if (seat.status === SeatStatus.held && seat.heldBy && seat.heldBy !== userId) {
      return "held-by-other";
    }

    if (seat.status === SeatStatus.held && seat.heldBy === userId) {
      await tx.seat.update({
        where: { showId_seatCode: { showId, seatCode } },
        data: {
          status: SeatStatus.available,
          heldBy: null,
          holdUntil: null
        }
      });
      return "available";
    }

    const holdUntil = new Date(Date.now() + holdMinutes * 60 * 1000);
    await tx.seat.update({
      where: { showId_seatCode: { showId, seatCode } },
      data: {
        status: SeatStatus.held,
        heldBy: userId,
        holdUntil
      }
    });
    return "held";
  });
}

export async function heldSeats(showId: number, userId: string): Promise<string[]> {
  const seats = await prisma.seat.findMany({
    where: {
      showId,
      heldBy: userId,
      status: SeatStatus.held
    },
    orderBy: { seatCode: "asc" },
    select: { seatCode: true }
  });
  return seats.map((seat) => seat.seatCode);
}

export async function freezeHeldSeats(showId: number, userId: string): Promise<void> {
  await prisma.seat.updateMany({
    where: {
      showId,
      heldBy: userId,
      status: SeatStatus.held
    },
    data: {
      holdUntil: null
    }
  });
}

export async function setUserState(state: UserStateRecord): Promise<void> {
  await prisma.userSession.upsert({
    where: { userId: state.user_id },
    create: {
      userId: state.user_id,
      state: state.state ?? null,
      showId: state.show_id ?? undefined,
      seats: state.seats ? state.seats.join(",") : null,
      total: state.total ?? null
    },
    update: {
      state: state.state ?? null,
      showId: state.show_id ?? undefined,
      seats: state.seats ? state.seats.join(",") : null,
      total: state.total ?? null,
      updatedAt: new Date()
    }
  });
}

export async function getUserState(userId: string): Promise<UserStateRecord | null> {
  const session = await prisma.userSession.findUnique({ where: { userId } });
  if (!session) {
    return null;
  }
  return {
    user_id: session.userId,
    state: session.state,
    show_id: session.showId ?? null,
    seats: session.seats ? session.seats.split(",").filter(Boolean) : null,
    total: session.total ?? null
  };
}

export async function clearUserState(userId: string): Promise<void> {
  await prisma.userSession.deleteMany({ where: { userId } });
}

export async function createOrder(params: {
  userId: string;
  showId: number;
  seats: string[];
  amount: number;
  receiptType: "photo" | "text";
  receiptRef: string;
}): Promise<number> {
  const order = await prisma.order.create({
    data: {
      userId: params.userId,
      showId: params.showId,
      seats: params.seats.join(","),
      amount: params.amount,
      receiptType: params.receiptType,
      receiptRef: params.receiptRef
    },
    select: { id: true }
  });
  return order.id;
}

export async function getOrder(orderId: number): Promise<OrderRecord | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return null;
  }
  return {
    id: order.id,
    user_id: order.userId,
    show_id: order.showId,
    seats: order.seats.split(",").filter(Boolean),
    amount: order.amount,
    status: order.status
  };
}

export async function approveOrder(orderId: number, adminId: string): Promise<OrderRecord | null> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return null;
    }
    if (order.status !== "pending") {
      return {
        id: order.id,
        user_id: order.userId,
        show_id: order.showId,
        seats: order.seats.split(",").filter(Boolean),
        amount: order.amount,
        status: order.status
      };
    }

    const seats = order.seats.split(",").filter(Boolean);
    if (seats.length > 0) {
      await tx.seat.updateMany({
        where: {
          showId: order.showId,
          seatCode: { in: seats }
        },
        data: {
          status: SeatStatus.sold,
          buyerId: order.userId,
          heldBy: null,
          holdUntil: null
        }
      });
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "approved",
        paidAt: new Date(),
        adminId
      }
    });

    await tx.userSession.deleteMany({ where: { userId: order.userId } });

    return {
      id: order.id,
      user_id: order.userId,
      show_id: order.showId,
      seats,
      amount: order.amount,
      status: "approved"
    };
  });
}

export async function rejectOrder(orderId: number, adminId: string): Promise<OrderRecord | null> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return null;
    }
    if (order.status !== "pending") {
      return {
        id: order.id,
        user_id: order.userId,
        show_id: order.showId,
        seats: order.seats.split(",").filter(Boolean),
        amount: order.amount,
        status: order.status
      };
    }

    const seats = order.seats.split(",").filter(Boolean);
    if (seats.length > 0) {
      await tx.seat.updateMany({
        where: {
          showId: order.showId,
          seatCode: { in: seats }
        },
        data: {
          status: SeatStatus.available,
          heldBy: null,
          holdUntil: null
        }
      });
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "rejected",
        adminId
      }
    });

    await tx.userSession.deleteMany({ where: { userId: order.userId } });

    return {
      id: order.id,
      user_id: order.userId,
      show_id: order.showId,
      seats,
      amount: order.amount,
      status: "rejected"
    };
  });
}
