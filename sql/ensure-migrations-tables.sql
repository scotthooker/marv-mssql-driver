IF NOT EXISTS (SELECT *
                 FROM INFORMATION_SCHEMA.TABLES
                 WHERE TABLE_SCHEMA = 'dbo'
                 AND  TABLE_NAME = 'migrations')
BEGIN
  CREATE TABLE migrations (
      level INTEGER,
      comment TEXT,
      "timestamp" datetimeoffset,
      checksum TEXT,
      namespace varchar(50) DEFAULT 'default',
      PRIMARY KEY (level, namespace)
  );

  CREATE TABLE migrations_lock (dummy_column INT NOT NULL DEFAULT 1);
END


