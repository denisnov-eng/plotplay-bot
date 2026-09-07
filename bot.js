const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2/promise');

// === КОНФИГУРАЦИЯ ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ ===
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '99933936';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://t.me/PlotPlay_Bot/vote';

if (!TOKEN) {
    console.error('❌ BOT_TOKEN не задан в переменных окружения');
    process.exit(1);
}

// === ПОДКЛЮЧЕНИЕ К БД ===
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10
});

// === ИНИЦИАЛИЗАЦИЯ БОТА ===
const bot = new TelegramBot(TOKEN, { polling: true });
console.log('✅ PlotPlay Bot запущен (Long Polling)');

// === ОБРАБОТКА СООБЩЕНИЙ ===
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`📩 /start from chat_id=${chatId}, user=${msg.from.username || msg.from.first_name}`);
    try {
        await sendWelcome(chatId);
    } catch (err) {
        console.error('sendWelcome error:', err.message);
        bot.sendMessage(chatId, '⚠️ Ошибка отправки. Попробуйте позже.');
    }
bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, '❓ <b>Помощь</b>\n\nНажмите /start чтобы вернуться в главное меню.', { parse_mode: 'HTML' });
});

// === ОБРАБОТКА CALLBACK ЗАПРОСОВ ===
bot.on('callback_query', async (cb) => {
    const data = cb.data;
    const chatId = cb.message.chat.id;

    try {
        await bot.answerCallbackQuery(cb.id);
    } catch (e) {}

    try {
        if (data === 'menu') await sendWelcome(chatId);
        else if (data === 'catalog') await sendCatalog(chatId);
        else if (data.startsWith('read_')) await sendChapter(chatId, parseInt(data.replace('read_', '')));
        else if (data.startsWith('vote_')) await sendVoteLink(chatId, parseInt(data.replace('vote_', '')));
        else if (data === 'authors') await sendAuthors(chatId);
        else if (data === 'want_author') await sendAuthorRequest(chatId, cb.from);
        else if (data === 'season1') await sendSeason1(chatId);
    } catch (err) {
        console.error('Handler error:', err.message);
        bot.sendMessage(chatId, '⚠️ Произошла ошибка. Попробуйте позже.');
    }
});

// === ФУНКЦИИ ОТПРАВКИ ===

async function sendWelcome(chatId) {
    const text = `👋 <b>Добро пожаловать в PlotPlay!</b>\n\n` +
        `Интерактивные истории, где ТЫ решаешь судьбу персонажей.\n\n` +
        `📚 Читай книги\n🗳️ Голосуй за сюжет\n✍️ Стань автором\n\n` +
        `Нажми «Старт» чтобы начать!`;

    await bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
            [{ text: '🚀 Старт', callback_data: 'catalog' }],
            [{ text: '🎬 Сезон 1', callback_data: 'season1' }],
            [{ text: '🔍 Поиск авторов', callback_data: 'authors' }]
        ]}
    });
}

async function sendCatalog(chatId) {
    const [books] = await pool.query(
        "SELECT id, title, genre_icon FROM mass_stories WHERE status='active' ORDER BY id LIMIT 4"
    );

    let text = '📚 <b>Каталог историй</b>\n\nВыберите книгу:';
    const kb = [];

    for (const b of books) {
        const [[{ count }]] = await pool.query(
            "SELECT COUNT(*) as count FROM mass_votes WHERE story_id=?", [b.id]
        );
        kb.push([{ text: `${b.genre_icon} ${b.title} (${count} 🗳️)`, callback_data: `read_${b.id}` }]);
    }
    kb.push([{ text: '⬅️ Главное меню', callback_data: 'menu' }]);

    await bot.sendPhoto(chatId, 'https://plotpay.ru/images/catalog.jpg', {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: kb }
    });
}

async function sendChapter(chatId, bookId) {
    const [[book]] = await pool.query(
        "SELECT title, genre_icon, description, image_url FROM mass_stories WHERE id=? AND status='active'",
        [bookId]
    );

    if (!book) {
        return bot.sendMessage(chatId, '❌ История не найдена.');
    }

    const text = `${book.genre_icon} <b>${book.title}</b>\n\n<b>Глава 1</b>\n\n${book.description}`;
    const img = book.image_url ? `https://plotpay.ru${book.image_url}` : 'https://plotpay.ru/images/default_chapter.jpg';

    await bot.sendPhoto(chatId, img, {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
            [{ text: '🗳️ Голосовать', callback_data: `vote_${bookId}` }],
            [{ text: '⬅️ К каталогу', callback_data: 'catalog' }]
        ]}
    });
}

async function sendVoteLink(chatId, bookId) {
    const text = `🗳️ <b>Голосование открыто!</b>\n\n` +
        `Перейдите в Web App чтобы выбрать вариант.\n\n💰 1 🔑 или 49₽\n⏳ 72 часа`;

    await bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
            [{ text: '🗳️ Открыть голосование', url: WEBAPP_URL }],
            [{ text: '⬅️ К главе', callback_data: `read_${bookId}` }]
        ]}
    });
}

async function sendAuthors(chatId) {
    const text = `🔍 <b>Поиск авторов</b>\n\nPlotPlay ищет талантливых авторов!\n\n` +
        `✍️ Пишите истории\n💰 Зарабатывайте на голосах\n🌟 Станьте хитом сезона`;

    await bot.sendPhoto(chatId, 'https://plotpay.ru/images/authors.jpg', {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
            [{ text: '✍️ Хочу быть автором', callback_data: 'want_author' }],
            [{ text: '⬅️ Главное меню', callback_data: 'menu' }]
        ]}
    });
}

async function sendAuthorRequest(chatId, user) {
    const notify = `🖊️ <b>Новая заявка автора!</b>\n\n` +
        `Имя: ${user.first_name || ''}\nUsername: @${user.username || 'нет'}\nID: ${user.id}\n` +
        `Дата: ${new Date().toLocaleString('ru-RU')}`;

    await bot.sendMessage(ADMIN_ID, notify, { parse_mode: 'HTML' });
    await bot.sendMessage(chatId, '✅ <b>Заявка отправлена!</b>\nАдминистратор свяжется с вами.', { parse_mode: 'HTML' });
}

async function sendSeason1(chatId) {
    const text = `🎬 <b>Сезон 1</b>\n\n4 интерактивные книги:\n` +
        `🎭 Новый директор\n🕵️ Дело №7\n🧛 Кровь и Бархат\n🚀 Петля\n\n` +
        `Голосование: 72 часа`;

    await bot.sendPhoto(chatId, 'https://plotpay.ru/images/season1.jpg', {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
            [{ text: '📚 К книгам', callback_data: 'catalog' }]
        ]}
    });
}

// Обработка ошибок polling
bot.on('polling_error', (err) => {
    console.error('Polling error:', err.message);
});
