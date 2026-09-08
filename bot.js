const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2/promise');
const https = require('https');
const http = require('http');

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '99933936';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://t.me/PlotPlay_Bot/vote';
const CHAT_URL = process.env.CHAT_URL || 'https://t.me/PlotPlay_Chat';
const WELCOME_IMG = process.env.WELCOME_IMG || 'https://plotpay.ru/images/welcome.jpg';

if (!TOKEN) { console.error('❌ BOT_TOKEN not set'); process.exit(1); }

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3310'),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10
});

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('✅ Bot started (MySQL)');

const userStates = {};

(async () => {
    try {
        const [rows] = await pool.query("SELECT COUNT(*) as c FROM mass_stories WHERE status='active'");
        console.log(`✅ DB connected. Active stories: ${rows[0].c}`);
    } catch (e) {
        console.error('❌ DB error:', e.message);
    }
})();

function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PlotPlayBot/1.0)' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadImage(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

async function sendLongMessage(chatId, text, parseMode, replyMarkup) {
    const MAX_LEN = 4000;
    if (text.length <= MAX_LEN) {
        await bot.sendMessage(chatId, text, { parse_mode: parseMode, reply_markup: replyMarkup });
        return;
    }
    const parts = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= MAX_LEN) {
            parts.push(remaining);
            break;
        }
        let cut = remaining.lastIndexOf('\n', MAX_LEN);
        if (cut < 100) cut = MAX_LEN;
        parts.push(remaining.substring(0, cut));
        remaining = remaining.substring(cut).trimStart();
    }
    for (let i = 0; i < parts.length; i++) {
        const kb = (i === parts.length - 1) ? replyMarkup : undefined;
        await bot.sendMessage(chatId, parts[i], { parse_mode: parseMode, reply_markup: kb });
    }
}

// === КОМАНДЫ ===
bot.onText(/\/start/, async (msg) => {
    try { await sendWelcome(msg.chat.id); } catch(e) { console.error('start err:', e.message); }
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, '❓ <b>Помощь</b>\n\nЗадайте свой вопрос, и мы ответим в ближайшее время.', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
            [{ text: '✉️ Написать вопрос', callback_data: 'ask_question' }],
            [{ text: '⬅️ Меню', callback_data: 'menu' }]
        ]}
    });
});

// === ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ ===
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    if (userStates[chatId] === 'waiting_question') {
        delete userStates[chatId];
        const question = msg.text;
        const user = msg.from;
        const notify = `❓ <b>Новый вопрос от пользователя!</b>\n\nИмя: ${user.first_name}\nUsername: @${user.username || 'нет'}\nID: ${user.id}\n\n💬 Вопрос:\n${question}\n\n📅 ${new Date().toLocaleString('ru-RU')}`;
        try {
            await bot.sendMessage(ADMIN_ID, notify, { parse_mode: 'HTML' });
            await bot.sendMessage(chatId, '✅ <b>Ваш вопрос отправлен!</b>\nМы ответим вам в ближайшее время.', { parse_mode: 'HTML' });
        } catch(e) {
            console.error('Question send error:', e.message);
            await bot.sendMessage(chatId, '⚠️ Ошибка отправки. Попробуйте позже.', { parse_mode: 'HTML' });
        }
    }
});

// === CALLBACK ЗАПРОСЫ ===
bot.on('callback_query', async (cb) => {
    const data = cb.data;
    const chatId = cb.message.chat.id;
    try { await bot.answerCallbackQuery(cb.id); } catch(e){}
    try {
        if (data === 'menu') await sendWelcome(chatId);
        else if (data === 'catalog') await sendCatalog(chatId);
        else if (data.startsWith('read_ch_')) {
            const parts = data.replace('read_ch_', '').split('_');
            await sendChapterByNum(chatId, parseInt(parts[0]), parseInt(parts[1]));
        }
        else if (data.startsWith('read_text_')) await sendReadText(chatId, parseInt(data.replace('read_text_', '')));
        else if (data.startsWith('read_')) await sendChapter(chatId, parseInt(data.replace('read_', '')));
        else if (data.startsWith('vote_')) await sendVoteLink(chatId, parseInt(data.replace('vote_', '')));
        else if (data === 'authors') await sendAuthors(chatId);
        else if (data === 'want_author') await sendAuthorRequest(chatId, cb.from);
        else if (data === 'ask_question') await askQuestion(chatId);
        else if (data === 'i_am_author') await sendAuthorInfo(chatId);
        else if (data === 'season1') await sendSeason1(chatId);
    } catch(err) { console.error('CB error:', err.message); }
});

// === ФУНКЦИИ ===

async function sendWelcome(chatId) {
    const welcomeText = `🎭 <b>Добро пожаловать в PlotPlay!</b>

Здесь ты не просто читаешь — ты решаешь, чем закончится история.

7 авторов. 7 книг. 7 жанров.
И только ТВОЙ голос определяет, что будет дальше.

⚡ <b>Как это работает:</b>

📖 Читай новую главу
🔀 В конце — выбор: как поступит герой?
⏳ У тебя 72 часа, чтобы проголосовать
✍️ Автор пишет продолжение по итогам голосования

Каждый голос — это 1 шаг, который меняет судьбу персонажа. Чем больше голосов — тем сильнее твой выбор.

🏆 <b>Сезон 1 уже стартовал!</b>
Призовой фонд: 40 000₽ для лучших авторов.

💎 1 голос = 49₽
💎 Пакет 10 голосов = 199₽ (выгода 59%!)

Ты готов к приключениям?`;

    const kb = { inline_keyboard: [
        [{ text: '🚀 Старт', callback_data: 'catalog' }],
        [{ text: '✍️ Я автор', callback_data: 'i_am_author' }]
    ]};

    try {
        const imgBuffer = await downloadImage(WELCOME_IMG);
        await bot.sendPhoto(chatId, imgBuffer, {
            caption: welcomeText,
            parse_mode: 'HTML',
            reply_markup: kb,
            filename: 'welcome.jpg'
        });
    } catch (e) {
        console.error('Welcome photo failed:', e.message);
        await bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML', reply_markup: kb });
    }
}

async function askQuestion(chatId) {
    await bot.sendMessage(chatId, '✉️ <b>Напишите ваш вопрос одним сообщением:</b>\n\n(Отправьте текст, и он будет передан администратору)', { parse_mode: 'HTML' });
    userStates[chatId] = 'waiting_question';
}

async function sendAuthorInfo(chatId) {
    const authorText = `<b>PlotPlay запускает первый сезон интерактивных книг в Telegram</b> — и ищет 7 авторов для 7 книг разных жанров.

<b>Как это работает:</b>
📖 Вы пишете книгу из 16 глав
🗳 После каждой главы читатели голосуют за поворот сюжета — 72 часа
⏱ У вас 96 часов, чтобы написать следующую главу по итогам голосования
🎭 Финал книги зависит не от вас, а от читателей. Вы ведёте сюжет, но развязку выбирает народ

Это формат, которого ещё нет на русскоязычном рынке: живой текстовый сериал, где автор и аудитория пишут историю вместе. Никто не знает, чем всё закончится, — даже вы.

<b>Призовой фонд сезона — 40 000 ₽:</b>
🥇 25 000 ₽ — книге, по которой читатели заплатили больше всего за сезон
🥈 10 000 ₽ — приз читательских симпатий (голосование за любимую книгу)
🥉 5 000 ₽ — приз редакции

<b>Плюс то, что не измеряется в деньгах:</b>
— живая реакция аудитории на каждую главу
— собственная читательская база и статистика
— портфолио первого интерактивного сериала в Telegram
— соавторство с тысячами читателей, которые будут спорить, плакать и требовать продолжения

<b>Кого ищем:</b>
— жанры: детектив, романтика, фэнтези, хоррор, боевик, слайсер
— умение писать быстро и держать дедлайн: глава каждые 96 часов — это марафон на 4 месяца
— готовность писать с запасом: на старте сезона у вас должно быть 2–3 готовые главы про запас
— умение писать «на развилках»: каждая глава должна заканчиваться выбором, от которого невозможно оторваться

<b>Как подать заявку:</b>
1. Синопсис вашей идеи (до 1500 знаков) — с возможными развилками сюжета
2. Пример главы или фрагмент (1500 знаков)`;

    await sendLongMessage(chatId, authorText, 'HTML', {
        inline_keyboard: [
            [{ text: '📩 Оставить заявку', callback_data: 'want_author' }],
            [{ text: '❓ Задать вопрос', callback_data: 'ask_question' }],
            [{ text: '⬅️ Меню', callback_data: 'menu' }]
        ]
    });
}

async function sendCatalog(chatId) {
    try {
        const [books] = await pool.query("SELECT id, title, genre_icon, image_url FROM mass_stories WHERE status='active' ORDER BY id");

        if (books.length === 0) {
            await bot.sendMessage(chatId, '📚 <b>Выберите книгу:</b>', { parse_mode: 'HTML' });
            await bot.sendMessage(chatId, 'Каталог пуст. Скоро появятся новые истории!');
            return;
        }

        // 1. Заголовок
        await bot.sendMessage(chatId, '📚 <b>Выберите книгу:</b>', { parse_mode: 'HTML' });

        // 2. Карточки книг: название + картинка + рейтинг + подробнее
        for (const b of books) {
            const [voteRows] = await pool.query("SELECT COUNT(*) as cnt FROM mass_votes WHERE story_id=?", [b.id]);
            const rating = (voteRows && voteRows[0]) ? voteRows[0].cnt : 0;
            const caption = `${b.genre_icon} <b>${b.title}</b>\n⭐ Рейтинг: ${rating} голосов`;

            const kb = { inline_keyboard: [[{ text: '📖 Подробнее', callback_data: `read_${b.id}` }]] };

            const thumbUrl = `https://plotpay.ru/images/thumbs/thumb_${b.id}.jpg`;
            let sent = false;

            if (b.image_url) {
                try {
                    const imgBuffer = await downloadImage(thumbUrl);
                    await bot.sendPhoto(chatId, imgBuffer, {
                        caption: caption,
                        parse_mode: 'HTML',
                        reply_markup: kb,
                        filename: `book_${b.id}.jpg`
                    });
                    sent = true;
                } catch (e) {
                    console.error(`Thumb failed for ${b.title}:`, e.message);
                }
            }

            if (!sent) {
                await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: kb });
            }
        }

                // 3. Кнопка меню внизу (невидимый символ вместо точки)
        await bot.sendMessage(chatId, 'Навигация:', {
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Меню', callback_data: 'menu' }]] }
        });

    } catch(e) {
        console.error('catalog error:', e.message);
        bot.sendMessage(chatId, '⚠️ Ошибка каталога');
    }
}

async function sendChapter(chatId, bookId) {
    try {
        const [[book]] = await pool.query("SELECT title, genre_icon, description, image_url FROM mass_stories WHERE id=? AND status='active'", [bookId]);
        if (!book) return bot.sendMessage(chatId, '❌ Книга не найдена');

        const kb = { inline_keyboard: [
            [{ text: '📖 Читать', callback_data: `read_text_${bookId}` }],
            [{ text: '🗳️ Голосовать', callback_data: `vote_${bookId}` }],
            [{ text: '💬 Обсуждать', url: `${CHAT_URL}?topic=${bookId}` }],
            [{ text: '⬅️ К каталогу', callback_data: 'catalog' }]
        ]};

        const caption = `${book.genre_icon} <b>${book.title}</b>\n\n${book.description || ''}`;

        // Используем превью вместо оригинальной обложки
        let imgUrl = null;
        if (book.image_url && book.image_url.trim() !== '') {
            imgUrl = `https://plotpay.ru/images/thumbs/thumb_${bookId}.jpg`;
        }

        if (imgUrl) {
            try {
                console.log('📷 Downloading chapter photo:', imgUrl);
                const imgBuffer = await downloadImage(imgUrl);
                await bot.sendPhoto(chatId, imgBuffer, {
                    caption: caption,
                    parse_mode: 'HTML',
                    reply_markup: kb,
                    filename: `cover_${bookId}.jpg`
                });
            } catch (photoErr) {
                console.error('Chapter photo failed:', photoErr.message);
                await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: kb });
            }
        } else {
            await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: kb });
        }
    } catch(e) {
        console.error('chapter error:', e.message);
        bot.sendMessage(chatId, '⚠️ Ошибка загрузки книги. Попробуйте позже.');
    }
}

async function sendReadText(chatId, bookId) {
    try {
        const [[book]] = await pool.query("SELECT title, genre_icon FROM mass_stories WHERE id=? AND status='active'", [bookId]);
        if (!book) return bot.sendMessage(chatId, '❌ Книга не найдена');

        const [[chapter]] = await pool.query(
            "SELECT chapter_num, title, content FROM mass_chapters WHERE story_id=? ORDER BY chapter_num ASC LIMIT 1",
            [bookId]
        );

        let text = '';
        let kb = [];

        if (chapter) {
            const chTitle = chapter.title ? `<b>${chapter.title}</b>\n\n` : '';
            text = `${book.genre_icon} <b>${book.title}</b>\n\n${chTitle}${chapter.content}`;

            const [[next]] = await pool.query(
                "SELECT id FROM mass_chapters WHERE story_id=? AND chapter_num>? ORDER BY chapter_num ASC LIMIT 1",
                [bookId, chapter.chapter_num]
            );
            if (next) {
                kb.push([{ text: '➡️ Следующая глава', callback_data: `read_ch_${bookId}_${chapter.chapter_num + 1}` }]);
            }
        } else {
            text = `${book.genre_icon} <b>${book.title}</b>\n\n📝 Главы пока не добавлены.`;
        }

        kb.push([
            { text: '🗳️ Голосовать', callback_data: `vote_${bookId}` },
            { text: '💬 Обсуждать', url: `${CHAT_URL}?topic=${bookId}` }
        ]);
        kb.push([
            { text: '⬅️ Назад к книге', callback_data: `read_${bookId}` },
            { text: '⬅️ К каталогу', callback_data: 'catalog' }
        ]);

        await sendLongMessage(chatId, text, 'HTML', { inline_keyboard: kb });
    } catch(e) { console.error('read error:', e.message); bot.sendMessage(chatId, '⚠️ Ошибка чтения'); }
}

async function sendChapterByNum(chatId, bookId, chapterNum) {
    try {
        const [[book]] = await pool.query("SELECT title, genre_icon FROM mass_stories WHERE id=? AND status='active'", [bookId]);
        if (!book) return bot.sendMessage(chatId, '❌ Книга не найдена');

        const [[chapter]] = await pool.query(
            "SELECT chapter_num, title, content FROM mass_chapters WHERE story_id=? AND chapter_num=?",
            [bookId, chapterNum]
        );

        if (!chapter) return bot.sendMessage(chatId, '❌ Глава не найдена');

        const chTitle = chapter.title ? `<b>${chapter.title}</b>\n\n` : '';
        const text = `${book.genre_icon} <b>${book.title}</b>\n\n${chTitle}${chapter.content}`;

        let kb = [];
        let navRow = [];
        if (chapterNum > 1) {
            navRow.push({ text: '⬅️ Предыдущая', callback_data: `read_ch_${bookId}_${chapterNum - 1}` });
        }
        const [[next]] = await pool.query(
            "SELECT id FROM mass_chapters WHERE story_id=? AND chapter_num>? ORDER BY chapter_num ASC LIMIT 1",
            [bookId, chapterNum]
        );
        if (next) {
            navRow.push({ text: '➡️ Следующая', callback_data: `read_ch_${bookId}_${chapterNum + 1}` });
        }
        if (navRow.length > 0) kb.push(navRow);

        kb.push([
            { text: '🗳️ Голосовать', callback_data: `vote_${bookId}` },
            { text: '💬 Обсуждать', url: `${CHAT_URL}?topic=${bookId}` }
        ]);
        kb.push([
            { text: '⬅️ Назад к книге', callback_data: `read_${bookId}` },
            { text: '⬅️ К каталогу', callback_data: 'catalog' }
        ]);

        await sendLongMessage(chatId, text, 'HTML', { inline_keyboard: kb });
    } catch(e) { console.error('chapter nav error:', e.message); }
}

async function sendVoteLink(chatId, bookId) {
    try {
        // 1. Получаем цену книги
        const [[voteInfo]] = await pool.query(
            "SELECT price_rub FROM mass_stories WHERE id=?",
            [bookId]
        );

        if (!voteInfo) {
            return bot.sendMessage(chatId, '❌ Книга не найдена');
        }

        const price = voteInfo.price_rub || 49;
        
        // 2. Формируем правильный URL для Web App
        const webAppUrl = `${WEBAPP_URL}?book=${bookId}`;

        // 3. Сразу отправляем кнопку, которая открывает приложение
        await bot.sendMessage(chatId, `🗳️ <b>Голосование открыто!</b>\n\nСтоимость голоса: ${price}₽`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { 
                            text: `🗳️ Голосовать за ${price}₽`, 
                            web_app: { url: webAppUrl } // <-- ВАЖНО: именно web_app, а не url
                        }
                    ],
                    [
                        { text: '⬅️ Назад к главе', callback_data: `read_${bookId}` }
                    ]
                ]
            }
        });

    } catch(e) {
        console.error('vote error:', e.message);
        bot.sendMessage(chatId, '⚠️ Ошибка открытия голосования');
    }
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
    try {
        const [books] = await pool.query("SELECT genre_icon, title FROM mass_stories WHERE status='active' ORDER BY id LIMIT 4");
        let list = books.map(b => `${b.genre_icon} ${b.title}`).join('\n');
        await bot.sendMessage(chatId, `🎬 <b>Сезон 1</b>\n\n${list}\n\nГолосование: 72 часа`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '📚 К книгам', callback_data: 'catalog' }]] }
        });
    } catch(e) { console.error('season error:', e.message); }
}

bot.on('polling_error', (err) => console.error('Polling error:', err.message));
