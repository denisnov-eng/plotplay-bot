const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2/promise');

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '99933936';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://t.me/PlotPlay_Bot/vote';

if (!TOKEN) { console.error('❌ BOT_TOKEN not set'); process.exit(1); }

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10
});

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('✅ Bot started');

// Логирование всех входящих сообщений
bot.on('message', (msg) => {
    console.log(`📨 chat=${msg.chat.id} text="${msg.text}" user=${msg.from?.username}`);
});

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id; // ← ПРАВИЛЬНЫЙ chat_id пользователя
    console.log(`🚀 /start from ${chatId}`);
    try {
        await sendWelcome(chatId);
    } catch (e) {
        console.error('sendWelcome error:', e.message);
        bot.sendMessage(chatId, '⚠️ Ошибка. Попробуйте позже.');
    }
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, '❓ <b>Помощь</b>\n\nНажмите /start', { parse_mode: 'HTML' });
});

bot.on('callback_query', async (cb) => {
    const data = cb.data;
    const chatId = cb.message.chat.id; // ← ПРАВИЛЬНЫЙ chat_id
    try { await bot.answerCallbackQuery(cb.id); } catch(e){}
    try {
        if (data === 'menu') await sendWelcome(chatId);
        else if (data === 'catalog') await sendCatalog(chatId);
        else if (data.startsWith('read_')) await sendChapter(chatId, parseInt(data.replace('read_', '')));
        else if (data.startsWith('vote_')) await sendVoteLink(chatId, parseInt(data.replace('vote_', '')));
        else if (data === 'authors') await sendAuthors(chatId);
        else if (data === 'want_author') await sendAuthorRequest(chatId, cb.from);
        else if (data === 'season1') await sendSeason1(chatId);
    } catch (err) {
        console.error('CB error:', err.message);
    }
});

async function sendWelcome(chatId) {
    const text = `👋 <b>Добро пожаловать в PlotPlay!</b>\n\nИнтерактивные истории, где ТЫ решаешь судьбу персонажей.\n\n📚 Читай книги\n🗳️ Голосуй за сюжет\n✍️ Стань автором`;
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
    try {
        const [books] = await pool.query("SELECT id, title, genre_icon FROM mass_stories WHERE status='active' ORDER BY id LIMIT 4");
        let kb = [];
        for (const b of books) {
            const [[{count}]] = await pool.query("SELECT COUNT(*) as count FROM mass_votes WHERE story_id=?", [b.id]);
            kb.push([{ text: `${b.genre_icon} ${b.title} (${count} 🗳️)`, callback_data: `read_${b.id}` }]);
        }
        kb.push([{ text: '⬅️ Меню', callback_data: 'menu' }]);
        await bot.sendMessage(chatId, '📚 <b>Каталог историй</b>', { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    } catch(e) { console.error('catalog error:', e.message); bot.sendMessage(chatId, '⚠️ Ошибка каталога'); }
}

async function sendChapter(chatId, bookId) {
    try {
        const [[book]] = await pool.query("SELECT title, genre_icon, description FROM mass_stories WHERE id=? AND status='active'", [bookId]);
        if (!book) return bot.sendMessage(chatId, '❌ Не найдено');
        await bot.sendMessage(chatId, `${book.genre_icon} <b>${book.title}</b>\n\n${book.description}`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [
                [{ text: '🗳️ Голосовать', callback_data: `vote_${bookId}` }],
                [{ text: '⬅️ Каталог', callback_data: 'catalog' }]
            ]}
        });
    } catch(e) { console.error('chapter error:', e.message); }
}

async function sendVoteLink(chatId, bookId) {
    await bot.sendMessage(chatId, '🗳️ <b>Голосование открыто!</b>\n\n💰 1 🔑 или 49₽\n⏳ 72 часа', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
            [{ text: '🗳️ Открыть голосование', url: WEBAPP_URL }],
            [{ text: '⬅️ К главе', callback_data: `read_${bookId}` }]
        ]}
    });
}

async function sendAuthors(chatId) {
    await bot.sendMessage(chatId, '🔍 <b>Поиск авторов</b>\n\n✍️ Пишите истории\n💰 Зарабатывайте\n🌟 Станьте хитом', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
            [{ text: '✍️ Хочу быть автором', callback_data: 'want_author' }],
            [{ text: '⬅️ Меню', callback_data: 'menu' }]
        ]}
    });
}

async function sendAuthorRequest(chatId, user) {
    const notify = `🖊️ <b>Новая заявка!</b>\nИмя: ${user.first_name}\n@${user.username || 'нет'}\nID: ${user.id}`;
    await bot.sendMessage(ADMIN_ID, notify, { parse_mode: 'HTML' });
    await bot.sendMessage(chatId, '✅ Заявка отправлена!', { parse_mode: 'HTML' });
}

async function sendSeason1(chatId) {
    await bot.sendMessage(chatId, '🎬 <b>Сезон 1</b>\n\n🎭 Новый директор\n🕵️ Дело №7\n🧛 Кровь и Бархат\n🚀 Петля', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '📚 К книгам', callback_data: 'catalog' }]] }
    });
}

bot.on('polling_error', (err) => console.error('Polling error:', err.message));
