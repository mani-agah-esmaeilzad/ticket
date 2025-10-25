import { sql, type VercelPoolClient } from "@vercel/postgres";

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
      await sql`
        CREATE TABLE IF NOT EXISTS shows (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
          rows INTEGER NOT NULL,
          cols INTEGER NOT NULL,
          price INTEGER NOT NULL
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS seats (
          id SERIAL PRIMARY KEY,
          show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
          seat_code TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'available',
          held_by TEXT,
          hold_until TIMESTAMP WITH TIME ZONE,
          buyer_id TEXT,
          CONSTRAINT unique_seat UNIQUE(show_id, seat_code)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
          seats TEXT NOT NULL,
          amount INTEGER NOT NULL,
          receipt_type TEXT NOT NULL,
          receipt_ref TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          paid_at TIMESTAMP WITH TIME ZONE,
          admin_id TEXT
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS user_sessions (
          user_id TEXT PRIMARY KEY,
          state TEXT,
          show_id INTEGER REFERENCES shows(id) ON DELETE SET NULL,
          seats TEXT,
          total INTEGER,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;

      const { rowCount } = await sql`SELECT id FROM shows LIMIT 1`;
      if (rowCount === 0) {
        const now = new Date();
        const startsAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        const { rows } = await sql`
          INSERT INTO shows (title, starts_at, rows, cols, price)
          VALUES ('نمایش تست', ${startsAt.toISOString()}, 6, 10, 250000)
          RETURNING id, rows, cols
        `;
        const show = rows[0];
        await seedSeats(show.id, show.rows, show.cols);
      }
    })();
  }
  return schemaInitialized;
}

export async function seedSeats(showId: number, rows: number, cols: number): Promise<void> {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, rows);
  const values: string[] = [];
  for (const letter of letters) {
    for (let col = 1; col <= cols; col += 1) {
      const code = `${letter}${col}`;
      values.push(`(${showId}, '${code}', 'available')`);
    }
  }
  if (values.length > 0) {
    const query = `
      INSERT INTO seats (show_id, seat_code, status)
      VALUES ${values.join(",")}
      ON CONFLICT (show_id, seat_code) DO NOTHING
    `;
    await sql.query(query);
  }
}

export async function listShows(): Promise<ShowRecord[]> {
  const { rows } = await sql<ShowRecord>`SELECT * FROM shows ORDER BY starts_at`;
  return rows;
}

export async function getShow(showId: number): Promise<ShowRecord | null> {
  const { rows } = await sql<ShowRecord>`SELECT * FROM shows WHERE id = ${showId}`;
  return rows[0] ?? null;
}

export async function releaseExpiredHolds(showId: number): Promise<void> {
  await sql`
    UPDATE seats
    SET status = 'available', held_by = NULL, hold_until = NULL
    WHERE show_id = ${showId}
      AND status = 'held'
      AND hold_until IS NOT NULL
      AND hold_until < CURRENT_TIMESTAMP
  `;
}

export async function seatStatusMap(showId: number): Promise<Record<string, SeatRecord>> {
  await releaseExpiredHolds(showId);
  const { rows } = await sql<SeatRecord>`SELECT * FROM seats WHERE show_id = ${showId}`;
  return rows.reduce<Record<string, SeatRecord>>((acc, seat) => {
    acc[seat.seat_code] = seat;
    return acc;
  }, {});
}

export async function toggleSeat(
  showId: number,
  seatCode: string,
  userId: string,
  holdMinutes: number
): Promise<"sold" | "held" | "available" | "held-by-other"> {
  return withTransaction(async (client) => {
    await client.sql`
      UPDATE seats
      SET status = 'available', held_by = NULL, hold_until = NULL
      WHERE show_id = ${showId}
        AND seat_code = ${seatCode}
        AND status = 'held'
        AND hold_until IS NOT NULL
        AND hold_until < CURRENT_TIMESTAMP
    `;

    const { rows } = await client.sql<SeatRecord>`
      SELECT * FROM seats
      WHERE show_id = ${showId} AND seat_code = ${seatCode}
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new Error("Seat not found");
    }

    const seat = rows[0];
    if (seat.status === "sold") {
      return "sold";
    }
    if (seat.status === "held" && seat.held_by && seat.held_by !== userId) {
      return "held-by-other";
    }

    if (seat.status === "held" && seat.held_by === userId) {
      await client.sql`
        UPDATE seats
        SET status = 'available', held_by = NULL, hold_until = NULL
        WHERE show_id = ${showId} AND seat_code = ${seatCode}
      `;
      return "available";
    }

    await client.sql`
      UPDATE seats
      SET status = 'held', held_by = ${userId}, hold_until = CURRENT_TIMESTAMP + make_interval(mins => ${holdMinutes})
      WHERE show_id = ${showId} AND seat_code = ${seatCode}
    `;
    return "held";
  });
}

export async function heldSeats(showId: number, userId: string): Promise<string[]> {
  const { rows } = await sql<{ seat_code: string }>`
    SELECT seat_code
    FROM seats
    WHERE show_id = ${showId}
      AND held_by = ${userId}
      AND status = 'held'
    ORDER BY seat_code
  `;
  return rows.map((row) => row.seat_code);
}

export async function freezeHeldSeats(showId: number, userId: string): Promise<void> {
  await sql`
    UPDATE seats
    SET hold_until = NULL
    WHERE show_id = ${showId}
      AND held_by = ${userId}
      AND status = 'held'
  `;
}

export async function setUserState(state: UserStateRecord): Promise<void> {
  const seatsText = state.seats ? state.seats.join(",") : null;
  await sql`
    INSERT INTO user_sessions (user_id, state, show_id, seats, total, updated_at)
    VALUES (${state.user_id}, ${state.state}, ${state.show_id}, ${seatsText}, ${state.total}, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id)
    DO UPDATE SET
      state = EXCLUDED.state,
      show_id = EXCLUDED.show_id,
      seats = EXCLUDED.seats,
      total = EXCLUDED.total,
      updated_at = CURRENT_TIMESTAMP
  `;
}

export async function getUserState(userId: string): Promise<UserStateRecord | null> {
  const { rows } = await sql<{ user_id: string; state: string | null; show_id: number | null; seats: string | null; total: number | null }>`
    SELECT user_id, state, show_id, seats, total
    FROM user_sessions
    WHERE user_id = ${userId}
  `;
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  return {
    user_id: row.user_id,
    state: row.state,
    show_id: row.show_id,
    seats: row.seats ? row.seats.split(",").filter(Boolean) : null,
    total: row.total
  };
}

export async function clearUserState(userId: string): Promise<void> {
  await sql`DELETE FROM user_sessions WHERE user_id = ${userId}`;
}

export async function createOrder(params: {
  userId: string;
  showId: number;
  seats: string[];
  amount: number;
  receiptType: "photo" | "text";
  receiptRef: string;
}): Promise<number> {
  const seatsText = params.seats.join(",");
  const { rows } = await sql<{ id: number }>`
    INSERT INTO orders (user_id, show_id, seats, amount, receipt_type, receipt_ref)
    VALUES (${params.userId}, ${params.showId}, ${seatsText}, ${params.amount}, ${params.receiptType}, ${params.receiptRef})
    RETURNING id
  `;
  return rows[0].id;
}

export async function getOrder(orderId: number): Promise<OrderRecord | null> {
  const { rows } = await sql<{ id: number; user_id: string; show_id: number; seats: string; amount: number; status: string }>`
    SELECT id, user_id, show_id, seats, amount, status
    FROM orders
    WHERE id = ${orderId}
  `;
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  return {
    id: row.id,
    user_id: row.user_id,
    show_id: row.show_id,
    seats: row.seats.split(",").filter(Boolean),
    amount: row.amount,
    status: row.status
  };
}

export async function approveOrder(orderId: number, adminId: string): Promise<OrderRecord | null> {
  return withTransaction(async (client) => {
    const { rows } = await client.sql<{ id: number; user_id: string; show_id: number; seats: string; amount: number; status: string }>`
      SELECT * FROM orders
      WHERE id = ${orderId}
      FOR UPDATE
    `;
    if (rows.length === 0) {
      return null;
    }
    const orderRow = rows[0];
    if (orderRow.status !== "pending") {
      return {
        id: orderRow.id,
        user_id: orderRow.user_id,
        show_id: orderRow.show_id,
        seats: orderRow.seats.split(",").filter(Boolean),
        amount: orderRow.amount,
        status: orderRow.status
      };
    }

    const seats = orderRow.seats.split(",").filter(Boolean);
    if (seats.length > 0) {
      await client.query(
        `UPDATE seats
         SET status = 'sold', buyer_id = $1, held_by = NULL, hold_until = NULL
         WHERE show_id = $2 AND seat_code = ANY($3::text[])`,
        [orderRow.user_id, orderRow.show_id, seats]
      );
    }

    await client.sql`
      UPDATE orders
      SET status = 'approved', paid_at = CURRENT_TIMESTAMP, admin_id = ${adminId}
      WHERE id = ${orderId}
    `;
    await client.sql`
      DELETE FROM user_sessions WHERE user_id = ${orderRow.user_id}
    `;

    return {
      id: orderRow.id,
      user_id: orderRow.user_id,
      show_id: orderRow.show_id,
      seats,
      amount: orderRow.amount,
      status: "approved"
    };
  });
}

export async function rejectOrder(orderId: number, adminId: string): Promise<OrderRecord | null> {
  return withTransaction(async (client) => {
    const { rows } = await client.sql<{ id: number; user_id: string; show_id: number; seats: string; amount: number; status: string }>`
      SELECT * FROM orders
      WHERE id = ${orderId}
      FOR UPDATE
    `;
    if (rows.length === 0) {
      return null;
    }
    const orderRow = rows[0];
    if (orderRow.status !== "pending") {
      return {
        id: orderRow.id,
        user_id: orderRow.user_id,
        show_id: orderRow.show_id,
        seats: orderRow.seats.split(",").filter(Boolean),
        amount: orderRow.amount,
        status: orderRow.status
      };
    }

    const seats = orderRow.seats.split(",").filter(Boolean);
    if (seats.length > 0) {
      await client.query(
        `UPDATE seats
         SET status = 'available', held_by = NULL, hold_until = NULL
         WHERE show_id = $1 AND seat_code = ANY($2::text[])`,
        [orderRow.show_id, seats]
      );
    }

    await client.sql`
      UPDATE orders
      SET status = 'rejected', admin_id = ${adminId}
      WHERE id = ${orderId}
    `;
    await client.sql`
      DELETE FROM user_sessions WHERE user_id = ${orderRow.user_id}
    `;

    return {
      id: orderRow.id,
      user_id: orderRow.user_id,
      show_id: orderRow.show_id,
      seats,
      amount: orderRow.amount,
      status: "rejected"
    };
  });
}

async function withTransaction<T>(fn: (client: VercelPoolClient) => Promise<T>): Promise<T> {
  const client = await sql.connect();
  try {
    await client.sql`BEGIN`;
    const result = await fn(client);
    await client.sql`COMMIT`;
    return result;
  } catch (error) {
    try {
      await client.sql`ROLLBACK`;
    } catch (rollbackError) {
      console.error("Failed to rollback transaction", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}
