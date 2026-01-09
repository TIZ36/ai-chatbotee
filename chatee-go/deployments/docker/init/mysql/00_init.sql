-- Initialize MySQL database for Chatee
-- This file is executed when the MySQL container starts

-- Use the chatee database
USE chatee;

-- Source the migration file
SOURCE /docker-entrypoint-initdb.d/001_initial_schema.sql;
