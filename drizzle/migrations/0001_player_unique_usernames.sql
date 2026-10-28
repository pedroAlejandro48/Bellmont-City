CREATE TABLE public.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 username text UNIQUE,
 CONSTRAINT username_format CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,24}$')
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "create own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE FUNCTION public.create_player_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN INSERT INTO public.profiles(id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING; RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.create_player_profile() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER create_player_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_player_profile();
INSERT INTO public.profiles(id) SELECT id FROM auth.users ON CONFLICT (id) DO NOTHING;
CREATE FUNCTION public.username_available(candidate text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT candidate ~ '^[a-z0-9_]{3,24}$' AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = candidate); $$;
REVOKE ALL ON FUNCTION public.username_available(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.username_available(text) TO authenticated, service_role;
CREATE FUNCTION public.username_login_email(candidate text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT u.email::text FROM public.profiles p JOIN auth.users u ON u.id = p.id WHERE p.username = candidate; $$;
REVOKE ALL ON FUNCTION public.username_login_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.username_login_email(text) TO service_role;