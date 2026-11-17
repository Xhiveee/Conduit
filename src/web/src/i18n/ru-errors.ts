export const ruErrors: Record<string, string> = {
    'error:agent is busy': 'Агент уже выполняет задачу',
    'error:chat not found': 'Чат не найден',
    'error:host not found': 'Хост не найден',
    'error:session not found': 'Сессия не найдена',
    'error:session closed': 'Сессия закрыта',
    'error:terminal view not available': 'Терминал недоступен',
    'error:address is required': 'Укажите адрес',
    'error:id is required': 'Укажите идентификатор',
    'error:empty target': 'Пустой адрес подключения',
    'error:no key path configured': 'Не указан путь к ключу',
    'error:LLM returned no choices': 'Модель не вернула ответ',
    'error:API key is required for api.openai.com': 'Для api.openai.com требуется API-ключ',
};

export const ruErrorRules: [RegExp, string][] = [
    [/^conduit\.json is corrupted:/, 'Файл conduit.json повреждён:'],
    [/^chat file (.*) is corrupted:/, 'Файл чата $1 повреждён:'],
    [/^unknown theme/, 'Неизвестная тема'],
    [/^unknown tool/, 'Неизвестный инструмент'],
    [/^missing host in/, 'Не найден хост в'],
    [/^host key mismatch for/, 'Не совпадает ключ хоста для'],
    [/^server rejected key/, 'Сервер отклонил ключ'],
    [/^LLM error:/, 'Ошибка модели:'],
    [/^invalid response from LLM endpoint:/, 'Некорректный ответ модели:'],
    [/^Error:/, 'Ошибка:'],
];
