const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '99933936';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://t.me/PlotPlay_Bot/vote';
const CHAT_URL = process.env.CHAT_URL || 'https://t.me/PlotPlayChat';

if (!TOKEN) { console.error('❌ BOT_TOKEN not set'); process.exit(1); }

// === ДЕМО-ДАННЫЕ (без базы данных) ===
const stories = [
    { id: 1, title: 'Новый директор', icon: '🎭', desc: 'Кто займёт кресло директора? Решаешь ты!' },
    { id: 2, title: 'Дело №7', icon: '🕵️', desc: 'Загадочное убийство в особняке. Найди виновного.' },
    { id: 3, title: 'Кровь и Бархат', icon: '🧛', desc: 'Вампирский бал. Чью сторону выберешь?' },
    { id: 4, title: 'Петля', icon: '🚀', desc: 'Космическая станция теряет связь. Время на исходе.' }
];

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('✅ Bot started (NO DB)');

// === ОБРАБОТЧИКИ КОМАНД ===
bot.onText(/\/start/, async (msg) => {
    try { await sendWelcome(msg.chat.id); } catch(e) { console.error('start err:', e.message); }
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, '❓ <b>Помощь</b>\n\nНажмите /start чтобы вернуться в главное меню.', { parse_mode: 'HTML' });
});

// === ОБРАБОТЧИК CALLBACK ЗАПРОСОВ ===
bot.on('callback_query', async (cb) => {
    const data = cb.data;
    const chatId = cb.message.chat.id;
    try { await bot.answerCallbackQuery(cb.id); } catch(e){}
    try {
        if (data === 'menu') await sendWelcome(chatId);
        else if (data === 'catalog') await sendCatalog(chatId);
        else if (data.startsWith('read_text_')) await sendReadText(chatId, parseInt(data.replace('read_text_', '')));
        else if (data.startsWith('read_')) await sendChapter(chatId, parseInt(data.replace('read_', '')));
        else if (data.startsWith('vote_')) await sendVoteLink(chatId, parseInt(data.replace('vote_', '')));
        else if (data === 'authors') await sendAuthors(chatId);
        else if (data === 'want_author') await sendAuthorRequest(chatId, cb.from);
        else if (data === 'season1') await sendSeason1(chatId);
    } catch(err) { console.error('CB error:', err.message); }
});

// === ФУНКЦИИ ОТПРАВКИ ===

async function sendWelcome(chatId) {
    await bot.sendMessage(chatId,
        '👋 <b>Добро пожаловать в PlotPlay!</b>\n\nИнтерактивные истории, где ТЫ решаешь судьбу персонажей.\n\n📚 Читай книги\n🗳️ Голосуй за сюжет\n✍️ Стань автором',
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
            [{ text: '🚀 Старт', callback_data: 'catalog' }],
            [{ text: '🎬 Сезон 1', callback_data: 'season1' }],
            [{ text: '🔍 Поиск авторов', callback_data: 'authors' }]
        ]}}
    );
}

async function sendCatalog(chatId) {
    let kb = [];
    for (const b of stories) {
        kb.push([{ text: `${b.icon} ${b.title}`, callback_data: `read_${b.id}` }]);
    }
    kb.push([{ text: '⬅️ Меню', callback_data: 'menu' }]);
    await bot.sendMessage(chatId, '📚 <b>Каталог историй</b>\n\nВыберите книгу:', { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
}

async function sendChapter(chatId, bookId) {
    const book = stories.find(s => s.id === bookId);
    if (!book) return bot.sendMessage(chatId, '❌ Книга не найдена');

    const text = `${book.icon} <b>${book.title}</b>\n\n${book.desc}`;

    await bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
            [{ text: '📖 Читать', callback_data: `read_text_${bookId}` }],
            [{ text: '🗳️ Голосовать', callback_data: `vote_${bookId}` }],
            [{ text: '💬 Обсуждать', url: `${CHAT_URL}?topic=${bookId}` }],
            [{ text: '⬅️ К каталогу', callback_data: 'catalog' }]
        ]}
    });
}

async function sendReadText(chatId, bookId) {
    const book = stories.find(s => s.id === bookId);
    if (!book) return bot.sendMessage(chatId, '❌ Книга не найдена');

    // Пока текст берётся из описания. Когда подключим БД — будем брать из mass_chapters
    const chapterText = book.desc || 'Текст главы скоро появится...';

    await bot.sendMessage(chatId, `📖 <b>${book.title}</b>\n\n${chapterText}`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
            [{ text: '🗳️ Голосовать', callback_data: `vote_${bookId}` }],
            [{ text: '💬 Обсуждать', url: `${CHAT_URL}?topic=${bookId}` }],
            [{ text: '⬅️ Назад к книге', callback_data: `read_${bookId}` }],
            [{ text: '⬅️ К каталогу', callback_data: 'catalog' }]
        ]}
    });
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
    const notify = `🖊️ <b>Новая заявка автора!</b>\n\nИмя: ${user.first_name}\nUsername: @${user.username || 'нет'}\nID: ${user.id}\nДата: ${new Date().toLocaleString('ru-RU')}`;
    await bot.sendMessage(ADMIN_ID, notify, { parse_mode: 'HTML' });
    await bot.sendMessage(chatId, '✅ <b>Заявка отправлена!</b>\nАдминистратор свяжется с вами.', { parse_mode: 'HTML' });
}

async function sendSeason1(chatId) {
    await bot.sendMessage(chatId, '🎬 <b>Сезон 1</b>\n\n🎭 Новый директор\n🕵️ Дело №7\n🧛 Кровь и Бархат\n🚀 Петля\n\nГолосование: 72 часа', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '📚 К книгам', callback_data: 'catalog' }]] }
    });
}

// === ОБРАБОТКА ОШИБОК ===
bot.on('polling_error', (err) => console.error('Polling error:', err.message));
