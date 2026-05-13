// src/utils/logger.js
// Logging utility

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../../config/config');

// Ensure logs directory exists
if (!fs.existsSync(config.logsDir)) {
    fs.mkdirSync(config.logsDir, { recursive: true });
}

// Create logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${message} ${
                Object.keys(meta).length ? JSON.stringify(meta) : ''
            }`;
        })
    ),
    transports: [
        // Console output
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        // File output - all logs
        new winston.transports.File({
            filename: path.join(config.logsDir, 'combined.log')
        }),
        // File output - errors only
        new winston.transports.File({
            filename: path.join(config.logsDir, 'error.log'),
            level: 'error'
        })
    ]
});

module.exports = logger;