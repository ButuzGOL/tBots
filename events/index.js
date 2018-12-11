const cheerio = require('cheerio');
const axios = require('axios');
const Telegraf = require('telegraf');
const moment = require('moment');
const {
  getLogger, getData, setData, sendPhoto,
} = require('../utils');

moment.locale('ru');

const { botToken } = require('../_cred');

const bot = new Telegraf(botToken);

const logger = getLogger(__dirname);

const API = 'https://odessa.kontramarka.ua';
const CHAT_NAME = process.env.NODE_ENV === 'production' ? '@togo_odessa' : '@butuzgoltestchat';

const FROM_DATE = +moment().add(0, 'd');
const TO_DATE = +moment().add(7, 'd');

async function getItems(dbData, type, countOfPages = 3) {
  logger.info(`Get items ${type}`);
  let data = {};
  const promises = [...Array(countOfPages).keys()].map(
    page => new Promise((resolve) => {
      logger.info('Fetching page %s', page);
      data[page] = [];
      axios
        .get(`${API}/ru/${type}?page=${page}`)
        .then((result) => {
          logger.info('Page fetched %s', page);
          const $ = cheerio.load(result.data);
          const items = $('#inner-events-contaienr .cat_item');
          if (!items.length) logger.warn('Page is empty');
          Array.prototype.forEach.call(items, (item) => {
            const $el = $(item);
            const href = $el.find('.cat_item__image').attr('href');
            const id = href
              .slice(4)
              .replace('.html', '')
              .replace('event/', '');

            data[page].push({
              id,
              image: $el.find('.block-info meta[itemprop=image]').attr('content'),
              title: $el
                .find('.block-info__title span')
                .text()
                .trim(),
              startDate: $el.find('.block-info meta[itemprop=startDate]').attr('content'),
              dates: $el.find('.dates .date_s').length
                ? $el
                  .find('.dates .date_s')
                  .text()
                  .trim()
                : [
                  $el
                    .find('.dates span:nth-child(2) span')
                    .text()
                    .trim(),
                  $el
                    .find('.dates span:nth-child(4) span')
                    .text()
                    .trim(),
                ],
              location: {
                name: $el.find('div[itemprop="location"] meta[itemprop=name]').attr('content'),
                address: $el
                  .find('div[itemprop="location"] meta[itemprop=address]')
                  .attr('content'),
                url: `${API}${$el.find('div[itemprop="location"] a[itemprop=url]').attr('href')}`,
              },
              price: $el
                .find('.block-info__price')
                .text()
                .trim(),
              url: `${API}${href}`,
            });
          });
          resolve();
        })
        .catch((e) => {
          logger.error('Page fetching error %s %o', page, e);
          resolve();
        });
    }),
  );

  await Promise.all(promises);

  let newData = [];
  [...Array(countOfPages).keys()].forEach((page) => {
    newData = newData.concat(data[page]);
  });
  data = newData;

  logger.info('Data filtering %s', data.length);

  data = data
    .filter(item => !dbData.find(iitem => iitem.id === item.id))
    .filter((item) => {
      const startDate = +moment(item.startDate);
      return startDate > FROM_DATE && startDate < TO_DATE;
    });

  logger.info('Data filtered %s', data.length);

  return data;
}

function formatMessage(item) {
  return [
    `[${item.title}](${item.url})`,
    `Дата: ${moment(item.startDate)
      .format('dd')
      .toUpperCase()} ${
      Array.isArray(item.dates) ? `${item.dates[0]} - ${item.dates[1]}` : `${item.dates}`
    }`,
    `Время: ${moment(item.startDate).format('HH:mm')}`,
    `Место: [${item.location.name} ${item.location.address}](${item.location.url})`,
    `Цена: ${item.price}`,
  ].join('\n');
}

async function sendItemMessage(bot, item) {
  logger.info('Sending message... %s %o', item.title, item.location);
  await sendPhoto(bot, CHAT_NAME, item.image, {
    caption: formatMessage(item),
  });
}

(async () => {
  const data = await getData('events');
  const circusItems = await getItems(data, 'circus');
  const concertItems = await getItems(data, 'concert');
  const theatreItems = await getItems(data, 'theatre');

  const items = circusItems.concat(concertItems.concat(theatreItems));
  items.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  if (items.length) {
    await setData('events', data.concat(items));

    await (async function () {
      for (const item of items) {
        await sendItemMessage(bot, item);
      }
    }());

    logger.info('done');
    process.exit();
  }
})();
