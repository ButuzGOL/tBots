// скидки одесса
// ! недвижимость одесса
// театры одесса
// события одесса
// functions and cron

const cheerio = require('cheerio');
const axios = require('axios');
const moment = require('moment');
const Telegraf = require('telegraf');
const request = require('request-promise');

const { getLogger, getData, setData, sendMessage } = require('../utils');
const { botToken } = require('../_cred');

const CHAT_NAME =
  process.env.NODE_ENV === 'production' ? 534377703 : '@butuzgoltestchat';

const WEATHER_API_KEY = '1a1771c098a4a7c1ea9a4dddd0b500b8';

const bot = new Telegraf(botToken);

const logger = getLogger(__dirname);

async function getKurs() {
  const result = {};
  logger.info('Fetching usd...');
  try {
    const usdPageResult = await axios('https://kurs.com.ua/gorod/1551-odessa/');
    const $ = cheerio.load(usdPageResult.data);
    const $el = $(
      '[data-blockid="app_kurs_blackMarket_k7vzyzbxe"] tbody tr:first-child',
    );
    const buy = $el.find('[data-rate-type="bid"]').data('rate');
    const sell = $el.find('[data-rate-type="ask"]').data('rate');
    result.usd = { buy, sell };
  } catch (e) {
    logger.info('Fetching usd error %o', e);
  }

  logger.info('Fetching bitkoin...');
  try {
    const bitkoinApi = await axios(
      'https://api.coindesk.com/v1/bpi/currentprice.json',
    );
    result.bitkoin = bitkoinApi.data.bpi.USD.rate;
  } catch (e) {
    logger.info('Fetching bitkoin error %o', e);
  }

  return result;
}

async function getWeather() {
  logger.info('Fetching weather...');
  try {
    const weatherResult = await request(
      `http://api.openweathermap.org/data/2.5/forecast?q=Odessa,ua&lang=ru&units=metric&appid=${WEATHER_API_KEY}`,
    );
    const weather = JSON.parse(weatherResult);
    return weather.list.filter(item => {
      const from = moment()
        .add(1, 'days')
        .set({ hours: 7, minutes: 0 });
      const to = moment()
        .add(1, 'days')
        .set({ hours: 23, minutes: 0 });
      const itemDate = moment(item.dt_txt);
      return itemDate.isAfter(from) && itemDate.isBefore(to);
    });
  } catch (e) {
    logger.info('Fetching weather error %o', e);
  }
}

function formatMessage(data) {
  const { kurs, weather } = data;

  const maxTemp = Math.round(Math.max(...weather.map(item => item.main.temp)));
  const minTemp = Math.round(Math.min(...weather.map(item => item.main.temp)));
  const formattedWeather = [
    minTemp === maxTemp ? minTemp : `${minTemp}-${maxTemp}`,
  ];

  let prev;
  weather.forEach(item => {
    const { description } = item.weather[0];
    if (prev !== description) {
      formattedWeather.push(
        moment(item.dt_txt).format('H') + ' ' + description,
      );
      prev = description;
    }
  });

  return [
    'Привет',
    `Погода ${formattedWeather.join(' ')}`,
    `USD ${kurs.usd.buy} ${kurs.usd.sell}`,
    `Bitcoin ${kurs.bitkoin}`,
  ].join('\n');
}

async function sendMeMessage(bot, data) {
  logger.info(
    'Sending message... %s %s %s',
    data.kurs.usd.buy,
    data.kurs.usd.sell,
    data.kurs.bitkoin,
  );
  await sendMessage(bot, CHAT_NAME, formatMessage(data));
}

(async function() {
  const weather = await getWeather();
  const kurs = await getKurs();
  await sendMeMessage(bot, { weather, kurs });
  logger.info('done');
})();
