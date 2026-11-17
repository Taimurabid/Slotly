import { hashPassword } from '../lib/auth.js';
import { toDateString, zonedTimeToUtc } from '../lib/time.js';
import { availabilityRules, blockedSlots } from './schema/availability.js';
import { bookings } from './schema/bookings.js';
import { providerProfiles } from './schema/providers.js';
import { users } from './schema/users.js';
import { createDb } from './client.js';

/**
 * Fills the database with realistic demo data: 3 providers, 5 customers,
 * a weekly availability pattern and a one-off block per provider, and a
 * handful of bookings (including one cancelled, to show status filtering).
 *
 * Every seeded account shares one password, documented in the README, so
 * anyone cloning the repo can log in and explore immediately.
 */
const SEED_PASSWORD = 'Seed-Password-123';

// All seed bookings land at least this many days out, safely past the
// 24-hour cancellation cutoff and immune to whatever day the script
// happens to be run on.
const MIN_DAYS_AHEAD = 5;

export function nextWeekday(targetDayOfWeek: number, minDaysAhead: number): string {
  const result = new Date();
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCDate(result.getUTCDate() + minDaysAhead);
  while (result.getUTCDay() !== targetDayOfWeek) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return toDateString(result);
}

export async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run the seed script');
  }
  const { db, pool } = createDb(databaseUrl);

  try {
    console.log('Clearing existing data...');
    // bookings references provider_profiles/users with ON DELETE RESTRICT
    // (a booking record should never silently disappear), so it has to go
    // first. Deleting users then cascades to provider_profiles,
    // availability_rules, blocked_slots and refresh_tokens.
    await db.delete(bookings);
    await db.delete(users);

    const passwordHash = await hashPassword(SEED_PASSWORD);

    console.log('Creating providers...');
    const providerDefs = [
      {
        email: 'amara.chen@example.com',
        name: 'Amara Chen',
        bio: 'Math and physics tutor for high school and college students.',
        timezone: 'America/New_York',
        sessionLengthMinutes: 60,
        priceCents: 7500,
        rules: [
          { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 }, // Mon 9-12
          { dayOfWeek: 3, startMinute: 14 * 60, endMinute: 18 * 60 }, // Wed 14-18
          { dayOfWeek: 5, startMinute: 9 * 60, endMinute: 12 * 60 }, // Fri 9-12
        ],
      },
      {
        email: 'daniel.osei@example.com',
        name: 'Daniel Osei',
        bio: 'Startup strategy consultant: go-to-market, pricing, fundraising prep.',
        timezone: 'America/Chicago',
        sessionLengthMinutes: 45,
        priceCents: 15000,
        rules: [
          { dayOfWeek: 2, startMinute: 10 * 60, endMinute: 16 * 60 }, // Tue 10-16
          { dayOfWeek: 4, startMinute: 10 * 60, endMinute: 16 * 60 }, // Thu 10-16
        ],
      },
      {
        email: 'priya.nair@example.com',
        name: 'Priya Nair',
        bio: 'Spanish tutor: conversational practice and exam preparation.',
        timezone: 'Europe/London',
        sessionLengthMinutes: 30,
        priceCents: 4000,
        rules: [
          { dayOfWeek: 1, startMinute: 17 * 60, endMinute: 20 * 60 }, // Mon 17-20
          { dayOfWeek: 3, startMinute: 17 * 60, endMinute: 20 * 60 }, // Wed 17-20
          { dayOfWeek: 5, startMinute: 17 * 60, endMinute: 20 * 60 }, // Fri 17-20
        ],
      },
    ];

    const providers: { id: string; timezone: string; sessionLengthMinutes: number }[] = [];
    for (const def of providerDefs) {
      const [user] = await db
        .insert(users)
        .values({ email: def.email, passwordHash, role: 'provider' })
        .returning({ id: users.id });
      if (!user) throw new Error(`Failed to insert user for ${def.email}`);

      const [profile] = await db
        .insert(providerProfiles)
        .values({
          userId: user.id,
          name: def.name,
          bio: def.bio,
          timezone: def.timezone,
          sessionLengthMinutes: def.sessionLengthMinutes,
          priceCents: def.priceCents,
        })
        .returning({ id: providerProfiles.id });
      if (!profile) throw new Error(`Failed to insert provider profile for ${def.email}`);

      await db.insert(availabilityRules).values(
        def.rules.map((rule) => ({
          providerId: profile.id,
          dayOfWeek: rule.dayOfWeek,
          startMinute: rule.startMinute,
          endMinute: rule.endMinute,
        })),
      );

      // One upcoming day off each, so the demo shows a block in action too.
      const blockDate = nextWeekday(def.rules[0]!.dayOfWeek, MIN_DAYS_AHEAD + 14);
      const blockStart = zonedTimeToUtc(blockDate, 0, def.timezone);
      const blockEnd = zonedTimeToUtc(blockDate, 24 * 60, def.timezone);
      await db.insert(blockedSlots).values({
        providerId: profile.id,
        startsAt: blockStart,
        endsAt: blockEnd,
        reason: 'Day off',
      });

      providers.push({
        id: profile.id,
        timezone: def.timezone,
        sessionLengthMinutes: def.sessionLengthMinutes,
      });
    }

    console.log('Creating customers...');
    const customerEmails = [
      'liam.johnson@example.com',
      'sophia.martinez@example.com',
      'noah.williams@example.com',
      'emma.davis@example.com',
      'oliver.brown@example.com',
    ];
    const customerIds: string[] = [];
    for (const email of customerEmails) {
      const [customer] = await db
        .insert(users)
        .values({ email, passwordHash, role: 'customer' })
        .returning({ id: users.id });
      if (!customer) throw new Error(`Failed to insert customer ${email}`);
      customerIds.push(customer.id);
    }

    console.log('Creating bookings...');
    const [amara, daniel, priya] = providers as [
      (typeof providers)[0],
      (typeof providers)[0],
      (typeof providers)[0],
    ];
    const [liam, sophia, noah, emma, oliver] = customerIds as [
      string,
      string,
      string,
      string,
      string,
    ];

    function slotRange(
      providerId: string,
      timezone: string,
      sessionLengthMinutes: number,
      dateStr: string,
      startMinute: number,
    ) {
      const startsAt = zonedTimeToUtc(dateStr, startMinute, timezone);
      const endsAt = new Date(startsAt.getTime() + sessionLengthMinutes * 60_000);
      return { providerId, startsAt, endsAt };
    }

    const bookingDefs = [
      {
        ...slotRange(
          amara.id,
          amara.timezone,
          amara.sessionLengthMinutes,
          nextWeekday(1, MIN_DAYS_AHEAD),
          9 * 60,
        ),
        customerId: liam,
        status: 'confirmed' as const,
      },
      {
        ...slotRange(
          amara.id,
          amara.timezone,
          amara.sessionLengthMinutes,
          nextWeekday(3, MIN_DAYS_AHEAD),
          15 * 60,
        ),
        customerId: sophia,
        status: 'confirmed' as const,
      },
      {
        ...slotRange(
          daniel.id,
          daniel.timezone,
          daniel.sessionLengthMinutes,
          nextWeekday(2, MIN_DAYS_AHEAD),
          10 * 60,
        ),
        customerId: noah,
        status: 'confirmed' as const,
      },
      {
        ...slotRange(
          daniel.id,
          daniel.timezone,
          daniel.sessionLengthMinutes,
          nextWeekday(4, MIN_DAYS_AHEAD),
          13 * 60,
        ),
        customerId: emma,
        status: 'cancelled' as const,
      },
      {
        ...slotRange(
          priya.id,
          priya.timezone,
          priya.sessionLengthMinutes,
          nextWeekday(5, MIN_DAYS_AHEAD),
          17 * 60,
        ),
        customerId: oliver,
        status: 'confirmed' as const,
      },
      {
        ...slotRange(
          priya.id,
          priya.timezone,
          priya.sessionLengthMinutes,
          nextWeekday(1, MIN_DAYS_AHEAD),
          17 * 60 + 30,
        ),
        customerId: liam,
        status: 'confirmed' as const,
      },
    ];

    for (const booking of bookingDefs) {
      await db.insert(bookings).values(booking);
    }

    console.log(
      `Seeded ${providerDefs.length} providers, ${customerEmails.length} customers, ` +
        `${providerDefs.reduce((n, p) => n + p.rules.length, 0)} availability rules, ` +
        `${providerDefs.length} blocked days, and ${bookingDefs.length} bookings.`,
    );
    console.log(`All seed accounts use the password: ${SEED_PASSWORD}`);
  } finally {
    await pool.end();
  }
}

// Only run as a side effect when this file is executed directly (`npm run
// db:seed`), not when it's imported elsewhere - e.g. a unit test importing
// `nextWeekday` should not trigger a full destructive database wipe.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
