const cheerio = require('cheerio');
const axios = require('axios');
const Telegraf = require('telegraf');
const {
  getLogger,
  getData,
  setData,
  sendMessage,
  sendPhoto,
} = require('../utils');

const { botToken } = require('../_cred');

const bot = new Telegraf(botToken);

const logger = getLogger(__dirname);

const API = 'https://novostroyki.lun.ua';
const CHAT_NAME =
  process.env.NODE_ENV === 'production'
    ? '@novostroyki_odessa'
    : '@butuzgoltestchat';

async function getItems(dbData, countOfPages = 3) {
  logger.info('Get items');
  let data = {};
  let promises = [...Array(countOfPages).keys()].map(
    page =>
      new Promise(resolve => {
        logger.info('Fetching page %s', page);
        data[page] = [];
        axios
          .get(
            `${API}/%D0%B2%D1%81%D0%B5-%D0%BD%D0%BE%D0%B2%D0%BE%D1%81%D1%82%D1%80%D0%BE%D0%B9%D0%BA%D0%B8-%D0%BE%D0%B4%D0%B5%D1%81%D1%81%D1%8B?page=${page +
              1}`,
          )
          .then(result => {
            logger.info('Page fetched %s', page);
            const $ = cheerio.load(result.data);
            const items = $('.card-grid .card-grid-cell');
            if (!items.length) logger.warn('Page is empty');
            Array.prototype.forEach.call(items, item => {
              const $el = $(item);
              const id = $el
                .find('.card>a')
                .attr('href')
                .slice(1);

              const developer = {};
              try {
                developer.name = $el
                  .find('.card-content .card-text:nth-child(3)')
                  .text()
                  .trim();
                const href = $el
                  .find('.card-content .card-actions a')
                  .attr('href');
                developer.website = href.includes('to=')
                  ? decodeURIComponent(href.slice(href.indexOf('to=') + 3))
                  : null;
              } catch (e) {}

              data[page].push({
                id,
                image: `http:${$el.find('.card-image').attr('src')}`,
                title: $el
                  .find('.card-title')
                  .text()
                  .trim(),
                location: $el
                  .find('.card-location')
                  .text()
                  .trim(),
                price: $el
                  .find('.card-content .card-price-value')
                  .text()
                  .trim(),
                developer,
                link: `${API}/${id}`,
              });
            });
            resolve();
          })
          .catch(e => {
            logger.error('Page fetching error %s %o', page, e);
            resolve();
          });
      }),
  );

  await Promise.all(promises);

  let newData = [];
  [...Array(countOfPages).keys()].forEach(page => {
    newData = newData.concat(data[page].reverse());
  });
  data = newData;

  logger.info('Data filtering %s', data.length);
  const resArr = [];
  data = data.filter(item => !dbData.find(iitem => iitem.id === item.id));
  logger.info('Data filtered %s', data.length);

  return data;
}

function formatMessage(item) {
  return [
    `[${item.title}](${item.link})`,
    `Девелопер: ${
      item.developer.website && item.developer.name
        ? `[${item.developer.name}](${item.developer.website})`
        : item.developer.name || item.developer.website
    }`,
    `Район: ${item.location}`,
    `Цена: ${item.price}`,
  ]
    .filter(item => item)
    .join('\n');
}

async function sendFlatMessage(bot, item) {
  logger.info('Sending message... %s %s', item.title, item.location);
  await sendPhoto(bot, CHAT_NAME, item.image, {
    caption: formatMessage(item),
  });
}

(async () => {
  const data = await getData('flats');
  const flats = await getItems(data);

  if (flats.length) {
    await setData('flats', data.concat(flats));

    await (async function() {
      for (const item of flats) {
        await sendFlatMessage(bot, item);
      }
    })();

    logger.info('done');
    process.exit();
  }
})();
