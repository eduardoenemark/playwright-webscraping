import winston from "winston";

const logger = winston.createLogger({
    level: "debug",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({timestamp, level, message}) => {
            return `${timestamp} [${level}]: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({timestamp, level, message}) => {
                    return `[${level}] ${timestamp} ${message}`;
                })
            )
        }),
        new winston.transports.File({
            filename: "application.log"
        })
    ]
});

export default logger;
