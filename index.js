import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import cron from 'node-cron';
import fs from 'fs';
import express from 'express';
import Payment from './models/payment.js';
import {
	productDescription,
	tarifPlansText,
	basicPlanDescription,
	cryptoPaymentInfo,
	cardPaymentInfo
} from './consts.js';

const app = express();

app.get('/', (req, res) => {
	res.send('Hello wordl');
});

const port = 3000;
app.listen(port, () => {
	log(`Server is running at http://localhost:${port}`);
});

dotenv.config();

// Get the Telegram bot token from the environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
const profilePictureFileId = process.env.PROFILE_PICTURE_FILE_ID;
const paymentsGroupChatId = process.env.PAYMENTS_GROUP_CHAT_ID;
const privateChannelId = process.env.YOUR_PRIVATE_CHANNEL_ID;
const supportUsername = 'serhiy_dvoryannikov';
const bot = new TelegramBot(token, {
	polling: true
});

// MongoDB connection details
const mongoUri = process.env.MONGO_URI;

// Connect to MongoDB using Mongoose
mongoose.connect(mongoUri, {
		useNewUrlParser: true,
		useUnifiedTopology: true
	})
	.then(() => log('Connected to MongoDB'))
	.catch((error) => log(`Error connecting to MongoDB: ${error}`, true));

// Function to log messages to a file
function log(message, error = false) {
	const logMessage = `[${new Date().toISOString()}] ${message}\n`;
	if (error) {
		fs.appendFileSync('error.log', logMessage);
	} else {
		fs.appendFileSync('app.log', logMessage);
	}
	console[error ? 'error' : 'log'](message);
}

// A map to store the original chat ID of users who sent payment screenshots
const userChatMap = new Map();

// Function to log stored user IDs and chat IDs
function logUserChatMap() {
	log('Current userChatMap entries:');
	for (const [userId, chatId] of userChatMap.entries()) {
		log(`User ID: ${userId}, Chat ID: ${chatId}`);
	}
}

// Check if the user has an active subscription
async function hasActiveSubscription(userId) {
	const latestPayment = await Payment.findOne({ user_id: userId }).sort({ payment_date: -1 }).exec();
	if (latestPayment) {
		const paymentDate = dayjs(latestPayment.payment_date);
		const expirationDate = paymentDate.add(1, 'month');
		return expirationDate.isAfter(dayjs());
	}
	return false;
}

// Scheduled task to check and remove expired subscriptions every 15 minutes
cron.schedule('*/15 * * * *', async () => {
	try {
		const users = await Payment.distinct("user_id");
		for (const userId of users) {
			const activeSubscription = await hasActiveSubscription(userId);
			if (!activeSubscription) {
				try {
					await bot.banChatMember(privateChannelId, userId);
					log(`Removed user ID: ${userId} from private channel due to expired subscription.`);

					// Notify the user
					const userChatId = userChatMap.get(userId.toString());
					if (userChatId) {
						await bot.sendMessage(userChatId, 'Ваша підписка закінчилась. Якщо ви бажаєте продовжити підписку, будь-ласка виконайте оплату знову.');
					} else {
						log(`Chat ID for user ID ${userId} not found in userChatMap.`, true);
					}

					// Delete payment records from the database
					await Payment.deleteMany({ user_id: userId });
					log(`Deleted payment records for user ID: ${userId}.`);
				} catch (error) {
					log(`Error banning user ID ${userId}: ${error}`, true);
				}
			}
		}
	} catch (error) {
		log('Error checking/removing expired subscriptions:', error);
	}
});

// Listen for the /start command
bot.onText(/\/start/, (msg) => {
	const chatId = msg.chat.id;

	// Send a message with the custom keyboard
	const opts = {
		caption: productDescription,
		reply_markup: {
			keyboard: [
				[{
						text: '📅 Тарифні плани'
					},
					{
						text: '💼 Мій тариф'
					},
					{ text: '📞 Підтримка' }
				]
			],
			resize_keyboard: true,
		}
	};

	bot.sendPhoto(chatId, profilePictureFileId, opts);
	log(`Sent product description to chat ID: ${chatId}`);
});

// Listen for text messages
bot.on('message', async (msg) => {
	const chatId = msg.chat.id;

	if (msg.text && msg.text.includes('Тарифні плани')) {
		const userId = msg.from.id;

		if (await hasActiveSubscription(userId)) {
			const latestPayment = await Payment.findOne({ user_id: userId }).sort({ payment_date: -1 }).exec();
			const paymentDate = dayjs(latestPayment.payment_date);
			const expirationDate = paymentDate.add(1, 'month');
			const formattedExpirationDate = expirationDate.format('YYYY-MM-DD HH:mm:ss');
			bot.sendMessage(chatId, `У вас активна підписка до ${formattedExpirationDate}`);
		} else {
			bot.sendMessage(chatId, tarifPlansText, {
				reply_markup: {
					inline_keyboard: [
						[{
							text: '1 місяць - 16$ | 650грн',
							callback_data: 'plan_1_month'
						}]
					]
				}
			});
		}
		log(`Handled 'Тарифні плани' message from user ID: ${userId}`);
	} else if (msg.text && msg.text.includes('Мій тариф')) {
		const userId = msg.from.id;

		try {
			const latestPayment = await Payment.findOne({ user_id: userId }).sort({ payment_date: -1 }).exec();
			if (latestPayment) {
				const paymentDate = dayjs(latestPayment.payment_date);
				const expirationDate = paymentDate.add(1, 'month');
				const formattedExpirationDate = expirationDate.format('YYYY-MM-DD HH:mm:ss');
				bot.sendMessage(chatId, `Ваша підписка дійсна до ${formattedExpirationDate}`);
			} else {
				bot.sendMessage(chatId, 'Немає данних про вашу підписку, якщо ви вважаєте що виникла помилка звертайтесь до нашої підтримки: <a href="https://t.me/serhiy_dvoryannikov">підтримка</a>.', { parse_mode: 'HTML' });
			}
		} catch (error) {
			log('Error retrieving payment record:', error);
			bot.sendMessage(chatId, 'Виникла помилка під час отримання данних про вашу підписку, спробуйте пізніше або звертайтесь до нашої підтримки: <a href="https://t.me/serhiy_dvoryannikov">підтримка</a>.', { parse_mode: 'HTML' });
		}
		log(`Handled 'Мій тариф' message from user ID: ${userId}`);
	} else if (msg.text && msg.text.includes('Підтримка')) {
		bot.sendMessage(chatId, `Якщо у вас виникла помилка з ботом, будь ласка, напишіть нашій підтримці: <a href="https://t.me/${supportUsername}">@${supportUsername}</a>`, { parse_mode: 'HTML' });
		log(`Handled 'Support' message from user ID: ${msg.from.id}`);
	} else if (msg.reply_to_message && (msg.reply_to_message.text.includes('Будь-ласка надішліть скріншот з оплатою у відповідь на це повідомлення.') || msg.reply_to_message.text.includes('Ваша оплата була відхилена, будь-ласка надішліть інший скріншот оплати.'))) {
		// Check if the message is a reply to the payment request message
		if (msg.photo) {
			// Forward the photo to the group
			const fileId = msg.photo[msg.photo.length - 1].file_id; // Get the file ID of the largest photo
			const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
			const userLink = `<a href="tg://user?id=${msg.from.id}">${username}</a>`;

			// Store the original chat ID and message ID
			userChatMap.set(msg.from.id.toString(), chatId);
			logUserChatMap(); // Log the current map entries for debugging

			bot.sendPhoto(paymentsGroupChatId, fileId, {
				caption: `Скріншот оплати від ${userLink}`,
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[{
								text: 'Дозволити',
								callback_data: `approve_${msg.from.id}`
							},
							{
								text: 'Заборонити',
								callback_data: `disapprove_${msg.from.id}`
							}
						]
					]
				}
			});
			log(`Forwarded payment screenshot from user ID: ${msg.from.id} to group chat ID: ${paymentsGroupChatId}`);

			// Notify the user that the payment is being processed
			bot.sendMessage(chatId, 'Ваша оплата обробляється, зачекайте доки вона буде підтверджена.');
		}
	}
});

// Listen for callback queries
bot.on('callback_query', async (callbackQuery) => {
	const message = callbackQuery.message;
	const data = callbackQuery.data;
	const from = callbackQuery.from;

	if (data === 'plan_1_month') {
		bot.editMessageText(basicPlanDescription, {
			chat_id: message.chat.id,
			message_id: message.message_id,
			reply_markup: {
				inline_keyboard: [
					[{
						text: '💳 Сплатити',
						callback_data: 'make_payment'
					}, ],
					[{
						text: 'Назад',
						callback_data: 'back_to_plans'
					}]
				]
			}
		});
	} else if (data === 'make_payment') {
		bot.editMessageText(basicPlanDescription, {
			chat_id: message.chat.id,
			message_id: message.message_id,
			reply_markup: {
				inline_keyboard: [
					[{
						text: '💸 Картою',
						callback_data: 'card_payment'
					}, ],
					[{
						text: '💲 Криптою',
						callback_data: 'crypto_payment'
					}, ],
					[{
						text: 'Назад',
						callback_data: 'plan_1_month'
					}]
				]
			}
		});
	} else if (data === 'crypto_payment') {
		bot.editMessageText(cryptoPaymentInfo, {
			chat_id: message.chat.id,
			message_id: message.message_id,
			reply_markup: {
				inline_keyboard: [
					[{
						text: 'Назад',
						callback_data: 'make_payment'
					}]
				]
			}
		}).then(() => {
			bot.sendMessage(message.chat.id, 'Будь-ласка надішліть скріншот з оплатою у відповідь на це повідомлення.', {
				reply_markup: {
					force_reply: true
				}
			});
		});
	} else if (data === 'card_payment') {
		bot.editMessageText(cardPaymentInfo, {
			chat_id: message.chat.id,
			message_id: message.message_id,
			reply_markup: {
				inline_keyboard: [
					[{
						text: 'Назад',
						callback_data: 'make_payment'
					}]
				]
			}
		}).then(() => {
			bot.sendMessage(message.chat.id, 'Будь-ласка надішліть скріншот з оплатою у відповідь на це повідомлення.', {
				reply_markup: {
					force_reply: true
				}
			});
		});
	} else if (data === 'back_to_plans') {
		bot.editMessageText(tarifPlansText, {
			chat_id: message.chat.id,
			message_id: message.message_id,
			reply_markup: {
				inline_keyboard: [
					[{
						text: '1 місяць - 16$ | 650грн',
						callback_data: 'plan_1_month'
					}],
				]
			}
		});
	} else if (data.startsWith('approve_')) {
		const userId = data.split('_')[1];
		const userChatId = userChatMap.get(userId);

		try {
			// Generate an invite link to the private channel
			const inviteLink = await bot.createChatInviteLink(privateChannelId, {
				member_limit: 1,
			});

			bot.sendMessage(paymentsGroupChatId, `Оплата <a href="tg://user?id=${userId}">користувача</a> прийнята.`, {
				parse_mode: 'HTML'
			});

			// Store payment information in MongoDB
			const username = from.username ? `@${from.username}` : from.first_name;
			const paymentData = new Payment({
				user_id: userId,
				username: username,
				amount: '16$', // Adjust as needed based on the selected plan
				payment_date: dayjs().format('YYYY-MM-DD HH:mm:ss')
			});
			await paymentData.save();
			log(`Stored payment info in MongoDB for username: ${username}`);

			// Notify the user about the approval and send the invite link
			if (userChatId) {
				bot.sendMessage(userChatId, `Ваша оплата була успішною! Будь-ласка доєднайтесь до приват каналу за цим посиланням: ${inviteLink.invite_link}`, {
					reply_markup: {
						keyboard: [
							[
								{ text: '📅 Тарифні плани' },
								{ text: '💼 Мій тариф' },
								{ text: '📞 Підтримка' }
							]
						],
						resize_keyboard: true,
					}
				});
			}
		} catch (error) {
			log('Помилка створення інвайт посилання:', error);
			bot.sendMessage(paymentsGroupChatId, `Помилка додавання користувача <a href="tg://user?id=${userId}">тут</a> до приват каналу. Будь-ласка спробуй пізніше.`, {
				parse_mode: 'HTML'
			});
		}
	} else if (data.startsWith('disapprove_')) {
		const userId = data.split('_')[1];
		const userChatId = userChatMap.get(userId);

		bot.sendMessage(paymentsGroupChatId, `Оплата від <a href="tg://user?id=${userId}">користувача</a> відхилена.`, {
			parse_mode: 'HTML'
		});

		if (userChatId) {
			bot.sendMessage(userChatId, 'Ваша оплата була відхилена, будь-ласка надішліть інший скріншот оплати.', {
				reply_markup: {
					keyboard: [
						[
							{ text: '📅 Тарифні плани' },
							{ text: '💼 Мій тариф' },
							{ text: '📞 Підтримка' }
						]
					],
					resize_keyboard: true,
					force_reply: true
				}
			});
		}
		log(`Handled disapprove action for user ID: ${userId}`);
	}
});

// Start the bot
log('Bot is running...');

export default (req, res) => {
	res.status(200).send('Bot is running');
};
