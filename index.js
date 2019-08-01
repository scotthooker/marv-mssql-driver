var fs = require('fs')
var path = require('path')
var _ = require('lodash')
var async = require('async')
var format = require('util').format
var debug = require('debug')('marv:mssql-driver')
var marv = require('marv')
var supportedDirectives = ['audit', 'comment', 'skip']
var pkg = require('./package.json')

module.exports = function(options) {

    var config = _.merge({ table: 'migrations', connection: {} }, _.omit(options, 'logger'))
    var logger = options.logger || console
    var SQL = {
        ensureMigrationsTables: load('ensure-migrations-tables.sql'),
        retrieveMigrations: load('retrieve-migrations.sql'),
        dropMigrationsTables: load('drop-migrations-tables.sql'),
        lockMigrationsLockTable: load('lock-migrations-lock-table.sql'),
        unlockMigrationsLockTable: load('unlock-migrations-lock-table.sql'),
        acquireLock: load('acquire-lock.sql'),
        releaseLock: load('release-lock.sql'),
        insertMigration: load('insert-migration.sql')
    }
    var mssql = config.mssql || require('mssql')
    var lockClient
    var lockTransaction
    var migrationClient
    var userClient

    function connect(cb) {
        lockClient = new mssql.ConnectionPool(config.connection)
        lockTransaction = lockClient.transaction()
        migrationClient = new mssql.ConnectionPool(config.connection)
        userClient = new mssql.ConnectionPool(config.connection)
        debug('Connecting to %s', getLoggableUrl())
        async.series([
            lockClient.connect.bind(lockClient),
            lockTransaction.begin.bind(lockTransaction),
            migrationClient.connect.bind(migrationClient),
            userClient.connect.bind(userClient)
        ], guard(cb))
    }

    function disconnect(cb) {
        debug('Disconnecting from %s', getLoggableUrl())
        async.series([
            lockTransaction.commit.bind(lockTransaction),
            lockClient.close.bind(lockClient),
            migrationClient.close.bind(migrationClient),
            userClient.close.bind(userClient)
        ], guard(cb))
    }

    function dropMigrations(cb) {
        migrationClient.query(SQL.dropMigrationsTables, guard(cb))
    }

    function ensureMigrations(cb) {
        debug('Ensure migrations')

        async.series([
            ensureMigrationsTables.bind(null, true),
            lockMigrations
        ], finish)

        function ensureMigrationsTables(firstRun, cb){
            migrationClient.query(SQL.ensureMigrationsTables, function (err) {
                if (firstRun && err && err.code === '23505') {
                    debug('Possible race condition when creating migration tables - retrying.')
                    setTimeout(ensureMigrationsTables.bind(null, false, cb), 100)
                } else {
                    cb(err)
                }
            })
        }

        function finish(err, results) {
            if (err) return cb(err)
            var steps = [];
            steps.push(unlockMigrations)
            async.series(steps, guard(cb))
        }
    }

    function lockMigrations(cb) {
        debug('Locking migration lock table')
        const request = lockTransaction.request()
        request.query(SQL.lockMigrationsLockTable, guard(cb))
    }

    function unlockMigrations(cb) {
        debug('Unlocking migration lock table')
        const request = lockTransaction.request()
        request.query(SQL.unlockMigrationsLockTable, guard(cb))
    }

    function getMigrations(cb) {
        migrationClient.query(SQL.retrieveMigrations, function(err, result) {
            if (err) return cb(err)
            cb(null, result.recordset)
        })
    }

    function runMigration(_migration, cb) {
        debug('Run migration')
        var migration = _.merge({}, _migration, { directives: marv.parseDirectives(_migration.script) })

        checkDirectives(migration.directives)

        if (/^true$/i.test(migration.directives.skip)) {
            debug('Skipping migration %s: %s\n%s', migration.level, migration.comment, migration.script)
            return cb()
        }

        debug('Run migration %s: %s\n%s', migration.level, migration.comment, migration.script)
        userClient.query(migration.script, function(err) {
            if (err) return cb(decorate(err, migration))
            if (auditable(migration)) {
                var request = migrationClient.request();
                request.input('level', mssql.VarChar, migration.level);
                request.input('timestamp', mssql.DateTimeOffset, migration.timestamp);
                request.input('comment', mssql.VarChar, migration.directives.comment || migration.comment);
                request.input('checksum', mssql.VarChar, migration.checksum);
                request.input('namespace', mssql.VarChar, migration.namespace || 'default');
                return request.query(SQL.insertMigration,
                    function(err) {
                        if (err) return cb(decorate(err, migration))
                    cb()
                })
            }
            cb()
        })
    }

    function checkDirectives(directives) {
        var unsupportedDirectives = _.chain(directives).keys().difference(supportedDirectives).value()
        if (unsupportedDirectives.length === 0) return
        if (!config.quiet) {
            logger.warn('Ignoring unsupported directives: %s. Try upgrading %s.', unsupportedDirectives, pkg.name)
        }
    }

    function auditable(migration) {
        if (migration.hasOwnProperty('directives')) return !/^false$/i.test(migration.directives.audit)
        if (migration.hasOwnProperty('audit')) {
            if (!config.quiet) logger.warn("The 'audit' option is deprecated. Please use 'directives.audit' instead.")
            return migration.audit !== false
        }
        return true
    }

    function getLoggableUrl() {
        return format('mssql://%s:%s@%s:%s/%s', userClient.config.user, '******', userClient.config.server, userClient.config.port, userClient.config.database)
    }

    function load(filename) {
        return fs.readFileSync(path.join(__dirname, 'sql', filename), 'utf-8').replace(/migrations/g, config.table)
    }

    function guard(cb) {
        return function(err) {
            cb(err)
        }
    }

    function decorate(err, migration) {
        return _.merge(err, { migration: migration })
    }

    return {
        connect: connect,
        disconnect: disconnect,
        dropMigrations: dropMigrations,
        ensureMigrations: ensureMigrations,
        lockMigrations: lockMigrations,
        unlockMigrations: unlockMigrations,
        getMigrations: getMigrations,
        runMigration: runMigration
    }
}
