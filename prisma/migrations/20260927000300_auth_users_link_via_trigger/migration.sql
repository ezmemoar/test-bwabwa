-- Hand-written. Replaces the foreign key profiles.id -> auth.users(id) with a trigger.
--
-- Why: Prisma can't introspect a database where a table it manages points into a schema it doesn't
-- (P4002), and letting Prisma manage `auth` instead makes it treat Supabase's own tables as drift to drop.
-- So `auth` stays invisible to Prisma, and the "delete the account, everything goes" guarantee is kept by a
-- trigger: deleting a Supabase user deletes their profile, which cascades to everything else they own.
-- (The API also checks auth.users before it creates a profile, which the foreign key used to enforce.)

ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_id_fkey";

-- SECURITY DEFINER functions belong in a schema the Supabase Data API doesn't expose.
CREATE SCHEMA IF NOT EXISTS climbly_private;
REVOKE ALL ON SCHEMA climbly_private FROM PUBLIC;

CREATE OR REPLACE FUNCTION climbly_private.delete_profile_of_deleted_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.profiles WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION climbly_private.delete_profile_of_deleted_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS climbly_delete_profile ON auth.users;
CREATE TRIGGER climbly_delete_profile
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION climbly_private.delete_profile_of_deleted_user();
