// russian title
// check trailer
// voters count

const axios = require('axios');
const { parseString } = require('xml2js');
const imdb = require('imdb');
const nameToImdb = require('name-to-imdb');
const search = require('youtube-search');
const Telegraf = require('telegraf');
const moment = require('moment');
const { getLogger, getData, setData, sendMessage } = require('../common/utils');

const { youtubeKey } = require('./_cred');
const { botToken } = require('../_cred');

const logger = getLogger(__dirname);

moment.locale('ru');

const API = 'https://planetakino.ua/odessa/showtimes/xml/';
const CHAT_NAME = process.env.NODE_ENV === 'production' ? '@kino_primera_ukraine' : '@butuzgoltestchat';

const bot = new Telegraf(botToken);

const youtubeSearchOpts = {
  maxResults: 10,
  // channelId: 'UC19Y4lMWFVa2vUNtWHwOmVg',
  key: youtubeKey,
};

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
          if (res.rating === 'N/A') {
            logger.error('imdb raiting not found');
            return resolve();
          }
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

function formatMessage(item) {
  return [
    item.youtube ? item.title : `[${item.title}](${item.link})`,
    item.imdb && `imdb: ${item.imdb.rating}`,
    item.imdb && `Длительность: ${item.imdb.runtime.replace('h', 'ч').replace('min', 'мин')}`,
    `Начало: ${moment(item.dtStart).format('LL')}`,
    `Конец: ${moment(item.dtEnd).format('LL')}`,
    item.imdb && `Режиссер: ${item.imdb.director}`,
    item.youtube && `[Трейлер](${item.youtube.link})`,
  ].filter(item => item).join('\n');
}

async function sendMovieMessage(bot, item) {
  logger.info('Sending message... %s %s', item.title, item.origName);
  await sendMessage(bot, CHAT_NAME, formatMessage(item));
}

(async function() {
  let data = await getData('kino');
  const movies = await getMovies(data);
  
  if (movies.length) {
    await setData('kino', data.concat(movies));

    await (async function() {
      for(const item of movies) {
        await sendMovieMessage(bot, item);
      }
    })();

    logger.info('done');
    process.exit();
  }
})();
