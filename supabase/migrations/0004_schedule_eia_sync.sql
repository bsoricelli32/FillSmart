-- Runs eia-sync every day at 22:07 UTC (4:07 pm Mountain, after EIA's afternoon releases).
-- The bearer token is the project's public anon key; it is already shipped in the app.
select cron.schedule(
  'eia-sync-daily',
  '7 22 * * *',
  $$
  select net.http_post(
    url := 'https://kvunlfjsdqrmafmilvrs.supabase.co/functions/v1/eia-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2dW5sZmpzZHFybWFmbWlsdnJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NzU0NDksImV4cCI6MjEwNjM1MTQ0OX0.XClMgDudRfLV4eHrG5JDLQjQNZQqaOfEoE8iGiVW3Ck'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
