const cheerio = require('cheerio');
const axios = require('axios');
const moment = require('moment');
const Telegraf = require('telegraf');
const { getLogger, getData, setData, sendMessage } = require('../common/utils');
const { botToken } = require('../_cred');

moment.locale('ru');

const TYPE_APL = 'englandPremierLeague';
const TYPE_CL = 'championsLeague';

const API = 'https://goal24.live';

const CHAT_NAME = process.env.NODE_ENV === 'production' ? '@football_video_apl_cl' : '@butuzgoltestchat';

const bot = new Telegraf(botToken);

const logger = getLogger(__dirname);

async function getItems(path, type, titleFilter, dbData, countOfPages = 2) {
  logger.info('Get items %s', type);
  let data = [];
  let promises = [...Array(countOfPages).keys()].map(page => (
    new Promise((resolve) => {
      logger.info('Fetching page %s', page);
      axios.get(`${API}/${path}/${page + 1}`)
        .then((result) => {
          logger.info('Page fetched %s', page);
          const $ = cheerio.load(result.data);
          const items = $('.videos .col-lg-4');
          if (!items.length) logger.warn('Page is empty');
          Array.prototype.forEach.call(items, item => {
            const $el = $(item).find('.title a');
            const id = $el.attr('href').slice(1);
            data.push({
              id,
              title: $el.text(),
              link: `${API}/${id}`,
              date: $(item).find('.info').text().split('\n')[1].trim(),
            });
          });
          resolve();
        })
        .catch(e => {
          logger.error('Page fetching error %s %o', page, e);
          resolve();
        });
    })
  ));
  
  await Promise.all(promises);

  logger.info('Data filtering %s', data.length);
  const resArr = [];
  data = data
    .filter(item => !dbData.find(iitem => iitem.id === item.id))
    .filter(item => item.title.includes(titleFilter))
    .filter((item) => {
      if (resArr.find(id => item.id === id)) return false;
      resArr.push(item.id);
      return true;
    });
  logger.info('Data filtered %s', data.length);

  logger.info('Data mapping');
  return data
    .map((item) => {
      if (item.date.match(/час|мин|ceк/)) {
        item.date = moment().format('YYYY-MM-DD');
      } else if (item.date.match(/день|дней|дня/)) {
        item.date = moment().subtract(parseInt(item.date), 'days').format('YYYY-MM-DD');
      } else {
        item.date = 'N/A';
      }

      const scoreRegExp = / [0-9]+:[0-9]+ /;
      const scoreMatches = item.title.match(scoreRegExp);
      if (scoreMatches) {
        item.score = scoreMatches[0].trim();
      }
      item.title = item.title
        .replace(scoreRegExp, ' - ')
        .replace(' | Обзор матча', '');
      item.type = type;
      return item;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function formatMessage(item) {
  return [
    item.title,
    `Дата: ${moment(item.date).format('LL')}`,
    `[Обзор](${item.link})`,
  ].join('\n');
}

async function sendVideoMessage(bot, item) {
  logger.info('Sending message... %s %s', item.title, item.date);
  await sendMessage(bot, CHAT_NAME, formatMessage(item));
}

(async function() {
  const data = await getData('goal');
  const englandData = await getItems('england', TYPE_APL, 'Английская Премьер-Лига', data);
  const championsLeagueData = await getItems('champions-league', TYPE_CL, 'Лига Чемпионов', data);

  const resultData = englandData.concat(championsLeagueData);
  if (resultData.length) {
    await setData('goal', resultData);

    await (async function() {
      for(const item of englandData) {
        await sendVideoMessage(bot, item);
      }
    })();

    await (async function() {
      for(const item of championsLeagueData) {
        await sendVideoMessage(bot, item);
      }
    })();

    logger.info('done');
  }
})();