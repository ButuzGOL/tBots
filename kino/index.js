// russian title
// check trailer
// cron

const axios = require('axios');
const { parseString } = require('xml2js');
const imdb = require('imdb');
const nameToImdb = require('name-to-imdb');
const GitHub = require('github-api');
const search = require('youtube-search');
const Telegraf = require('telegraf');
const moment = require('moment');
const { createLogger, transports, format } = require('winston');

const { botToken, youtubeKey, ghToken, gistId } = require('./_cred');

const { combine, timestamp, colorize, printf, simple, splat } = format;
const logger = createLogger({
  transports: [
    new transports.Console({ format: combine(splat(), colorize(), simple()) }),
    new transports.File({
      format: combine(
        splat(),
        timestamp(),
        printf(info => `${info.timestamp} ${info.level}: ${info.message}`),
      ),
      filename: __dirname + '/main.log'
    }),
  ],
});

moment.locale('ru');


const API = 'https://planetakino.ua/odessa/showtimes/xml/';
const CHAT_NAME = '@butuzgoltestchat';

const bot = new Telegraf(botToken);

const youtubeSearchOpts = {
  maxResults: 10,
  // channelId: 'UC19Y4lMWFVa2vUNtWHwOmVg',
  key: youtubeKey,
};

const gh = new GitHub({ token: ghToken });

async function getMovies(dbData) {
  logger.info('Get movies');
  let xmlApiResult;
  try {
    xmlApiResult = await axios.get(API);
  } catch(e) {
    logger.error('Api error %o', e);
    return;
  }

  const data = await new Promise(resolve => {
    parseString(xmlApiResult.data, (err, result) => resolve(result))
  });

  let movies = data['planeta-kino'].movies[0].movie.map(item => item);
  logger.info('Data xmp to json %s', movies.length);
  movies = movies
    .filter(item => {
      const startDate = new Date(item['dt-start'][0]);
      startDate.setDate(startDate.getDate() - 5);
      const result = startDate.getTime() < new Date().getTime();
      return result;
    })
    .map(item => {
      const parts = item.$.url.split('/');
      const id = parts[parts.length - 2];
      return {
        id,
        origName: id.replace(/-|_/ig, ' '),
        title: item.title[0],
        link: item.$.url,
        dtStart: item['dt-start'][0],
        dtEnd: item['dt-end'][0],
      }
    })
    .filter(item => !dbData.find(iitem => iitem.id === item.id));

  logger.info('Data filtered %s', movies.length);
  const promises = [];
  movies.forEach((item, index) => {
    promises.push(new Promise(resolve => {
      logger.info('Fetching imdb %s %s', item.title, item.origName);
      nameToImdb({
        name: item.origName,
        year: new Date().getFullYear(),
        type: 'movie'
      }, (err, res) => {
        if (err || !res) {
          logger.warn('imdb id not found or error %o', err);
          return resolve();
        }
        const imdbId = res;
        imdb(imdbId, (err, res) => {
          if (err) {
            logger.error('imdb item fetching error %o', err);
            return resolve();
          }
          movies[index].imdb = {
            id: imdbId,
            link: `http://www.imdb.com/title/${imdbId}`,
            title: res.title,
            runtime: res.runtime,
            rating: res.rating,
            poster: res.poster,
            director: res.director,
            year: res.year,
          };
          search(`${item.origName} ${new Date().getFullYear()} трейлер на русском`, youtubeSearchOpts, (err, res) => {
            if (err) {
              logger.error('youtube fetching error %o', err);
              return resolve();
            }
            if (res.length) {
              movies[index].youtube = {
                id: res[0].id,
                link: res[0].link,
              };
            }
            logger.info('imdb youtube fetched %s %s %s',
              movies[index].title,
              movies[index].imdb.link,
              movies[index].youtube ? movies[index].youtube.link : '',
            );
            resolve();
          });
        });
      });
    }));
  });

  await Promise.all(promises);
  return movies;
}

async function getData() {
  logger.info('Fetching data from db...');
  let gistRead;
  try {
    const gist = await gh.getGist(gistId);
    gistRead = await gist.read();
  } catch(e) {
    logger.error('Fetched data from db error', e);
  }
  return JSON.parse(gistRead.data.files.kino.content);
}

async function setData(data) {
  logger.info('Setting data to db...');
  try {
    const gist = await gh.getGist(gistId);
    const gistRead = await gist.update({
      files: { kino: { content: JSON.stringify(data, null, 2) } },
    });
  } catch(e) {
    logger.error('Setting data to db error %o', e);
  }
}

function formatMessage(item) {
  return [
    item.imdb ? item.title : `[${item.title}](${item.link})`,
    item.imdb && `imdb: ${item.imdb.rating}`,
    item.imdb && `Длительность: ${item.imdb.runtime.replace('h', 'ч').replace('min', 'мин')}`,
    `Начало: ${moment(item.dtStart).format('LL')}`,
    `Конец: ${moment(item.dtEnd).format('LL')}`,
    item.youtube && item.youtube.link,
  ].filter(item => item).join('\n');
}

async function sendMessage(bot, item) {
  logger.info('Sending message... %s %s', item.title, item.origName);
  try {
    await bot.telegram.sendMessage(CHAT_NAME, formatMessage(item), { parse_mode: 'Markdown' });
  } catch(e) {
    logger.error('Setting message error %o', e);
  }
}

(async function() {
  let data = await getData();
  const movies = await getMovies(data);
  
  if (movies.length) {
    data = data.concat(movies);
    await setData(data);

    await (async function() {
      for(const item of movies) {
        await sendMessage(bot, item);
      }
    })();

    logger.info('done');
    process.exit();
  }
})();
