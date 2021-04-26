'use strict';
const chromium = require('chrome-aws-lambda');
const puppeteer = chromium.puppeteer;
const cheerio = require('cheerio');
const axios = require('axios');
const AWS = require('aws-sdk');

const url = 'https://www.hotukdeals.com/tag/gaming';
const gameProviders = [
	'base.com',
	'cdkeys',
	'nintendo eshop',
	'google play',
	'the game collection',
	'fanatical',
	'simply games',
	'gamersgate',
	'playstation store',
	'gamesplanet',
	'microsoft (microsoft store)',
	'steam store',
	'game',
	'humble bundle',
	'indiegala',
	'xbox.com store',
	'eneba',
	'go2games',
	'365games.co.uk',
	'steelseries shop',
];
let promiseArray = [];
let titles = [];

AWS.config.update({ region: 'eu-west-2', endpoint: 'dynamodb.eu-west-2.amazonaws.com' });

async function scrapeContent(content) {
	const $ = cheerio.load(content);

	console.log('starting: data scrapping', content === undefined);
	$('.thread--expired').remove();
	$('.js-newsletter-widget').remove();

	$('.threadGrid').each((idx, elem) => {
		const merchantName = $(elem).find('.cept-merchant-name').text();

		// Remove unwanted merchants
		if (!gameProviders.includes(merchantName.toLowerCase())) return 1;

		const title = $(elem).find('.thread-title--list').text();
		const price = $(elem).find('.thread-price').text();
		const dealButton = $(elem).find('.cept-dealBtn').attr('href');

		// Skip ads?
		if (dealButton === undefined) return 1;

		const description = $(elem).find('.cept-description-container').contents().first().text();
		const image = $(elem).find('.cept-thread-img').attr('src');
		const metaRibbon = $(elem).find('.cept-meta-ribbon-hot span:first').text();
		const metaRibbonExpires = $(elem).find('.cept-meta-ribbon-expires span:first').text();

		promiseArray.push(
			axios
				.get(dealButton)
				.then((data) => {
					titles.push({
						title,
						price,
						merchantName,
						link: data.request.res.responseUrl,
						description,
						image,
						metaRibbon,
						metaRibbonExpires,
					});
				})
				.catch((error) => {
					console.error('error');
				})
		);
	});
	console.log('finisnig: data scrapping', titles[1]);
	return Promise.all(promiseArray);
}

module.exports.index = async (event, context) => {
	let browser = null;
	try {
		browser = await puppeteer.launch({
			defaultViewport: { width: 1024, height: 800 },
			headless: true,
			executablePath: await chromium.executablePath,
			args: chromium.args,
		});

		const page = await browser.newPage();
		await page.goto(url, {
			waitUntil: ['domcontentloaded', 'networkidle0'],
		});
		const content = await page.content();
		page.on('requestfailed', (request) => {
			console.log(`url: ${request.url()}, errText: ${request.failure().errorText}, method: ${request.method()}`);
		});
		// Catch console log errors
		page.on('pageerror', (err) => {
			console.log(`Page error: ${err.toString()}`);
		});
		// Catch all console messages
		page.on('console', (msg) => {
			console.log('Logger:', msg.type());
			console.log('Logger:', msg.text());
			console.log('Logger:', msg.location());
		});
		await scrapeContent(content).then(createGamesTable()).then(updateAWSDB());
		// await scrapeContent(content).then(updateAWSDB());

		// console.log('ENVIRONMENT VARIABLES\n' + JSON.stringify(process.env, null, 2));
		// console.info('EVENT\n' + JSON.stringify(event, null, 2));
		// console.warn('Event not processed.');
		return {
			statusCode: 200,
			message: 'done',
		};
	} catch (error) {
		return {
			statusCode: 500,
		};
	} finally {
		if (browser) await browser.close();
	}
};

function updateAWSDB() {
	const AWSdb = new AWS.DynamoDB({ apiVersion: '2012-10-08' });
	const AWSDBC = new AWS.DynamoDB.DocumentClient({ region: 'eu-west-2' });
	console.log('starting: put new items into database');
	// Co
	console.log(`check: if items exist, `, titles[0]);
	let newTitles = {};
	titles.forEach(function (game, idx) {
		const params = {
			TableName: 'Games',
			Item: {
				id: 'game' + idx,
				title: game.title,
				price: game.price,
				merchantName: game.merchantName,
				link: game.link,
				description: game.description,
				image: game.image,
				metaRibbon: game.metaRibbon,
			},
			ConditionExpression: '#title <>  :title',
			ExpressionAttributeNames: {
				'#title': 'title',
			},
			ExpressionAttributeValues: {
				':title': { S: game.title },
			},
		};
		AWSDBC.put(params, (err, data) => {
			if (err) {
				console.error('Unable to add new item', 'Error JSON:', JSON.stringify(err, null, 2));
			} else {
				console.log('PutItem succeded');
			}
		});
		// try {
		// 	AWSDBC.put(params).promise();
		// } catch (error) {
		// 	console.log('Error while trying to put data into database');
		// 	console.log(error);
		// }
	});
}

function createGamesTable() {
	var dynamodb = new AWS.DynamoDB();
	var params = {
		TableName: 'Games',
		KeySchema: [
			{ AttributeName: 'title', KeyType: 'HASH' },
			{ AttributeName: 'price', KeyType: 'RANGE' },
			{ AttributeName: 'merchantName', KeyType: 'RANGE' },
			{ AttributeName: 'link', KeyType: 'RANGE' },
			{ AttributeName: 'description', KeyType: 'RANGE' },
			{ AttributeName: 'image', KeyType: 'RANGE' },
			{ AttributeName: 'metaRibbon', KeyType: 'RANGE' },
		],
		AttributeDefinitions: [
			{ AttributeName: 'title', AttributeType: 'S' },
			{ AttributeName: 'price', AttributeType: 'S' },
			{ AttributeName: 'merchantName', AttributeType: 'S' },
			{ AttributeName: 'link', AttributeType: 'S' },
			{ AttributeName: 'description', AttributeType: 'S' },
			{ AttributeName: 'image', AttributeType: 'S' },
			{ AttributeName: 'metaRibbon', AttributeType: 'S' },
		],
		ProvisionedThroughput: {
			ReadCapacityUnits: 5,
			WriteCapacityUnits: 5,
		},
	};

	dynamodb.createTable(params, function (err, data) {
		if (err) {
		} else {
		}
	});
}
