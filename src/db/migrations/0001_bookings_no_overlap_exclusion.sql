-- Belt-and-suspenders against double-booking: even if two requests for the
-- same slot both pass the application-level check at the same instant,
-- Postgres itself refuses the second INSERT. btree_gist lets a GiST
-- exclusion constraint compare a plain uuid column (provider_id) alongside
-- a range type (tstzrange), which GiST can't do on its own.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- Only confirmed bookings exclude each other, so cancelling a booking frees
-- the slot immediately for a new one covering the same range.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
    "provider_id" WITH =,
    tstzrange("starts_at", "ends_at") WITH &&
  )
  WHERE ("status" = 'confirmed');
