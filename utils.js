const GitHub = require('github-api');
const { createLogger, transports, format } = require('winston');
const { ghToken, gistId } = require('./_cred');

const gh = new GitHub({ token: ghToken });

let logger;
function getLogger(dir) {
  if (logger) return logger;
  const { combine, timestamp, colorize, printf, simple, splat } = format;
  logger = createLogger({
    transports: [],
  });

  if (process.env.NODE_ENV !== 'production') {
    logger.add(
      new transports.Console({
        format: combine(splat(), colorize(), simple()),
      }),
    );
  } else {
    logger.add(
      new transports.File({
        format: combine(
          splat(),
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          printf(info => `${info.timestamp} ${info.level}: ${info.message}`),
        ),
        filename: dir + '/main.log',
      }),
    );
  }

  return logger;
}

async function getData(name) {
  logger.info('Fetching data from db...');
  let gistRead;
  try {
    const gist = await gh.getGist(gistId);
    gistRead = await gist.read();
  } catch (e) {
    logger.error('Fetched data from db error', e);
  }
  return JSON.parse(gistRead.data.files[name].content);
}

async function setData(name, data) {
  logger.info('Setting data to db...');
  try {
    const gist = await gh.getGist(gistId);
    const gistRead = await gist.update({
      files: { [name]: { content: JSON.stringify(data, null, 2) } },
    });
  } catch (e) {
    logger.error('Setting data to db error %o', e);
  }
}

async function sendMessage(bot, chatName, message) {
  logger.info(
    'Sending message... %s',
    message.replace(/\n/g, ' ').slice(0, 20) + '...',
  );
  try {
    await bot.telegram.sendMessage(chatName, message, {
      parse_mode: 'Markdown',
    });
  } catch (e) {
    logger.error('Sending message error %o', e);
  }
}

async function sendPhoto(bot, chatName, source, extra) {
  logger.info('Sending photo...');
  try {
    await bot.telegram.sendPhoto(chatName, source, {
      parse_mode: 'Markdown',
      ...extra,
    });
  } catch (e) {
    logger.error('Sending photo error %o', e);
  }
}

module.exports = {
  getLogger,
  getData,
  setData,
  sendMessage,
  sendPhoto,
};
