[![Build Status](https://img.shields.io/travis/infinitaslearning/marv-mssql-driver/master.svg)](https://travis-ci.org/infinitaslearning/marv-mssql-driver)
[![Code Style](https://img.shields.io/badge/code%20style-imperative-brightgreen.svg)](https://github.com/guidesmiths/eslint-config-imperative)

# marv-sql-svr-driver
A SQL Server driver for [marv](https://www.npmjs.com/package/marv)

"If @cressie176 can do it, anyone can." Anon, 2019

## Usage
```
migrations/
  |- 001.create-table.sql
  |- 002.create-another-table.sql
```

```js
const marv = require('marv')
const mssqlDriver = require('marv-mssql-driver')
const directory = path.join(process.cwd(), 'migrations' )
const driver = mssqlDriver({
    table: 'db_migrations',     // defaults to 'migrations'
    connection: {               // the connection sub document is passed directly to mssql
        host: 'localhost',
        port: 1433,
        database: 'dbo',
        user: 'sa',
        password: 'Marv@234!',
        options: {
            encrypt: true // Use this if you're on Windows Azure
        }
    }
})
marv.scan(directory, (err, migrations) => {
    if (err) throw err
    marv.migrate(migrations, driver, (err) => {
        if (err) throw err
    })
})
```

## SQL Server locally for testing

The password is: `Marv@234!`

## Testing
```bash
npm install # or yarn
npm run docker
npm test
```
