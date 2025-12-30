-- 001_create_users.sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,

  name TEXT NOT NULL,
  phone TEXT,

  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_token TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
