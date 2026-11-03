-- GDPR part 3: project folder files are no longer reachable through public links.
-- The app opens them through 1-hour signed links (js/ordner.js signedProjectFileUrl).
-- Manual rollback: update storage.buckets set public = true where id = 'project-files';
update storage.buckets set public = false where id = 'project-files';
