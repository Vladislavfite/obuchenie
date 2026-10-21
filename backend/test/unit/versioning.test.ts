import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  moduleContentSignature, diffModuleContent, validateModuleForPublish,
  versionScores, moduleState, isModuleUnlocked, blockCompletionPct,
  buildQuestionSet, gradeAttempt, toEmployeeQuestions,
  sanitizeRichText, safeLinkUrl, parseVideoUrl, parseZoomUrl,
  suggestLogin, dueStatus, attemptsLeft,
} from '@tbedu/shared';
import type { ModuleVersionContent, Question } from '@tbedu/shared';

/* Тесты закрепляют правила, ради которых система и переписывалась.
   Если какое-то из них сломается, поведение системы изменится незаметно —
   поэтому они проверяются отдельно от остального кода. */

function baseContent(): ModuleVersionContent {
  return {
    title: 'Модуль',
    chapter: 'Глава 1',
    description: 'Описание',
    speaker: 'Иванов',
    accessCode: '1234',
    passingScore: 70,
    attemptLimit: 3,
    isRequired: true,
    randomQuestions: false,
    questionCount: 0,
    shuffleOptions: false,
    contentItems: [
      { type: 'text', title: 'Раздел', sortOrder: 0, payload: { html: '<p>Текст</p>' } },
    ],
    questions: [
      {
        sortOrder: 0, text: 'Вопрос?', type: 'single', explanation: 'Потому что',
        difficulty: 'normal', isPractical: false, points: 1,
        options: [
          { sortOrder: 0, text: 'Да', isCorrect: true },
          { sortOrder: 1, text: 'Нет', isCorrect: false },
        ],
      },
    ],
  };
}

describe('Версионирование модулей', () => {
  test('косметические поля не меняют подпись содержания', () => {
    const before = baseContent();
    const after = { ...baseContent(), chapter: 'Глава 2', speaker: 'Петров', accessCode: '9999' };
    assert.equal(moduleContentSignature(before), moduleContentSignature(after));
    assert.equal(diffModuleContent(before, after).substantive, false);
  });

  test('изменение текста вопроса требует новой версии', () => {
    const before = baseContent();
    const after = baseContent();
    after.questions[0].text = 'Другой вопрос?';
    const diff = diffModuleContent(before, after);
    assert.equal(diff.substantive, true);
    assert.ok(diff.changedFields.includes('questions'));
  });

  test('смена правильного ответа требует новой версии', () => {
    const before = baseContent();
    const after = baseContent();
    after.questions[0].options[0].isCorrect = false;
    after.questions[0].options[1].isCorrect = true;
    assert.equal(diffModuleContent(before, after).substantive, true);
  });

  test('изменение проходного балла требует новой версии', () => {
    const after = { ...baseContent(), passingScore: 80 };
    assert.equal(diffModuleContent(baseContent(), after).substantive, true);
  });

  test('изменение учебного текста требует новой версии', () => {
    const after = baseContent();
    (after.contentItems[0].payload as { html: string }).html = '<p>Новый текст</p>';
    assert.equal(diffModuleContent(baseContent(), after).substantive, true);
  });

  test('идентификаторы не влияют на подпись', () => {
    const before = baseContent();
    const after = baseContent();
    after.contentItems[0].id = 'other-id';
    after.questions[0].id = 'another-id';
    assert.equal(moduleContentSignature(before), moduleContentSignature(after));
  });
});

describe('Валидация перед публикацией', () => {
  test('модуль без правильного ответа не публикуется', () => {
    const content = baseContent();
    content.questions[0].options.forEach((o) => (o.isCorrect = false));
    const problems = validateModuleForPublish(content);
    assert.ok(problems.some((p) => p.message.includes('правильный ответ')));
  });

  test('вопрос без объяснения не публикуется', () => {
    const content = baseContent();
    content.questions[0].explanation = '';
    assert.ok(validateModuleForPublish(content).some((p) => p.message.includes('объяснение')));
  });

  test('нельзя выдавать больше вопросов, чем есть в банке', () => {
    const content = { ...baseContent(), questionCount: 10 };
    assert.ok(validateModuleForPublish(content).some((p) => p.message.includes('банке')));
  });

  test('корректный модуль проходит проверку', () => {
    assert.deepEqual(validateModuleForPublish(baseContent()), []);
  });
});

describe('Расчёт результатов', () => {
  const attempt = (over: Partial<{ moduleVersionId: string; score: number; passed: boolean; finishedAt: string }>) => ({
    moduleVersionId: 'v1', version: 1, score: 50, passed: false,
    finishedAt: '2026-01-01T10:00:00Z', startedAt: '2026-01-01T09:00:00Z', ...over,
  });

  test('официальный балл — первый сданный, а не лучший', () => {
    const scores = versionScores([
      attempt({ score: 40, passed: false, finishedAt: '2026-01-01T10:00:00Z' }),
      attempt({ score: 75, passed: true, finishedAt: '2026-01-02T10:00:00Z' }),
      attempt({ score: 95, passed: true, finishedAt: '2026-01-03T10:00:00Z' }),
    ]);
    assert.equal(scores.officialScore, 75);
    assert.equal(scores.bestScore, 95);
    assert.equal(scores.passed, true);
  });

  test('незавершённые попытки не учитываются', () => {
    const scores = versionScores([attempt({ finishedAt: null as never })]);
    assert.equal(scores.attemptCount, 0);
    assert.equal(scores.passed, false);
  });

  test('прохождение старой версии даёт состояние outdated', () => {
    const state = moduleState({
      module: { id: 'm1', sortOrder: 0, currentVersion: 2, publishedVersionId: 'v2',
                status: 'published', isRequired: true, attemptLimit: 3, passingScore: 70 },
      attempts: [attempt({ moduleVersionId: 'v1', score: 90, passed: true })],
      unlocked: true,
    });
    assert.equal(state.code, 'outdated');
    assert.equal(state.passedOlderVersion, true);
    assert.equal(state.passedCurrent, false);
  });

  test('исчерпание попыток даёт состояние exhausted', () => {
    const state = moduleState({
      module: { id: 'm1', sortOrder: 0, currentVersion: 1, publishedVersionId: 'v1',
                status: 'published', isRequired: true, attemptLimit: 2, passingScore: 70 },
      attempts: [attempt({ score: 30 }), attempt({ score: 40, finishedAt: '2026-01-02T10:00:00Z' })],
      unlocked: true,
    });
    assert.equal(state.code, 'exhausted');
    assert.equal(state.attemptsLeft, 0);
  });

  test('дополнительная попытка снимает блокировку', () => {
    const state = moduleState({
      module: { id: 'm1', sortOrder: 0, currentVersion: 1, publishedVersionId: 'v1',
                status: 'published', isRequired: true, attemptLimit: 2, passingScore: 70 },
      attempts: [attempt({ score: 30 }), attempt({ score: 40, finishedAt: '2026-01-02T10:00:00Z' })],
      extraAttempts: 1,
      unlocked: true,
    });
    assert.equal(state.code, 'failed');
    assert.equal(state.attemptsLeft, 1);
  });

  test('без лимита попыток остаток не ограничен', () => {
    assert.equal(attemptsLeft(0, 100), null);
  });

  test('последовательный блок закрывает модуль, пока не сдан предыдущий', () => {
    const block = {
      id: 'b1', sequential: true, prereqBlockId: null, requiredPct: 100,
      modules: [
        { id: 'm1', sortOrder: 0, currentVersion: 1, publishedVersionId: 'v1', status: 'published',
          isRequired: true, attemptLimit: 0, passingScore: 70 },
        { id: 'm2', sortOrder: 1, currentVersion: 1, publishedVersionId: 'v2', status: 'published',
          isRequired: true, attemptLimit: 0, passingScore: 70 },
      ],
    };
    const empty = new Map();
    assert.equal(isModuleUnlocked(block, 1, empty), false);

    const passed = new Map([['m1', [attempt({ moduleVersionId: 'v1', passed: true, score: 80 })]]]);
    assert.equal(isModuleUnlocked(block, 1, passed), true);
    assert.equal(blockCompletionPct(block, passed), 50);
  });
});

describe('Формирование теста и проверка ответов', () => {
  const questions: Question[] = [
    { id: 'q1', sortOrder: 0, text: 'В1', type: 'single', difficulty: 'normal', isPractical: false, points: 1,
      options: [{ id: 'o1', sortOrder: 0, text: 'A', isCorrect: true },
                { id: 'o2', sortOrder: 1, text: 'B', isCorrect: false }] },
    { id: 'q2', sortOrder: 1, text: 'В2', type: 'multiple', difficulty: 'normal', isPractical: false, points: 2,
      options: [{ id: 'o3', sortOrder: 0, text: 'C', isCorrect: true },
                { id: 'o4', sortOrder: 1, text: 'D', isCorrect: true },
                { id: 'o5', sortOrder: 2, text: 'E', isCorrect: false }] },
  ];

  test('ограничение количества вопросов соблюдается', () => {
    const set = buildQuestionSet(questions, { randomQuestions: true, questionCount: 1, shuffleOptions: false,
      random: () => 0.5 });
    assert.equal(set.length, 1);
  });

  test('вопросы для сотрудника не содержат правильных ответов', () => {
    const set = buildQuestionSet(questions, { randomQuestions: false, questionCount: 0, shuffleOptions: false });
    const forEmployee = toEmployeeQuestions(set, questions);
    const serialized = JSON.stringify(forEmployee);
    assert.ok(!serialized.includes('isCorrect'));
    assert.ok(!serialized.includes('explanation'));
  });

  test('множественный выбор засчитывается только при полном совпадении', () => {
    const set = buildQuestionSet(questions, { randomQuestions: false, questionCount: 0, shuffleOptions: false });
    const partial = gradeAttempt(set, questions,
      [{ questionId: 'q1', optionIds: ['o1'] }, { questionId: 'q2', optionIds: ['o3'] }], 70);
    assert.equal(partial.answers[1].isCorrect, false);

    const full = gradeAttempt(set, questions,
      [{ questionId: 'q1', optionIds: ['o1'] }, { questionId: 'q2', optionIds: ['o3', 'o4'] }], 70);
    assert.equal(full.answers[1].isCorrect, true);
    assert.equal(full.score, 100);
    assert.equal(full.passed, true);
  });

  test('баллы учитывают вес вопроса', () => {
    const set = buildQuestionSet(questions, { randomQuestions: false, questionCount: 0, shuffleOptions: false });
    /* Верен только вопрос весом 1 из общего веса 3. */
    const result = gradeAttempt(set, questions, [{ questionId: 'q1', optionIds: ['o1'] }], 70);
    assert.equal(result.score, 33);
    assert.equal(result.passed, false);
  });

  test('пустой ответ не засчитывается', () => {
    const set = buildQuestionSet(questions, { randomQuestions: false, questionCount: 0, shuffleOptions: false });
    const result = gradeAttempt(set, questions, [], 70);
    assert.equal(result.correctCount, 0);
    assert.equal(result.score, 0);
  });
});

describe('Безопасность содержимого', () => {
  test('скрипты вырезаются вместе с содержимым', () => {
    const clean = sanitizeRichText('<p>До</p><script>alert(1)</script><p>После</p>');
    assert.ok(!clean.includes('alert'));
    assert.ok(clean.includes('До'));
    assert.ok(clean.includes('После'));
  });

  test('обработчики событий снимаются', () => {
    const clean = sanitizeRichText('<p onclick="steal()">Текст</p>');
    assert.ok(!clean.includes('onclick'));
    assert.ok(clean.includes('Текст'));
  });

  test('javascript-ссылки не сохраняются', () => {
    assert.ok(!sanitizeRichText('<a href="javascript:alert(1)">тык</a>').includes('javascript'));
    assert.equal(safeLinkUrl('javascript:alert(1)'), '');
    assert.equal(safeLinkUrl('https://example.com/a'), 'https://example.com/a');
  });

  test('ссылка с html-сущностями не обходит проверку', () => {
    const clean = sanitizeRichText('<a href="javascript&#58;alert(1)">тык</a>');
    assert.ok(!clean.toLowerCase().includes('javascript'));
  });

  test('iframe не сохраняется', () => {
    assert.ok(!sanitizeRichText('<iframe src="https://evil.tld"></iframe>').includes('iframe'));
  });

  test('разрешённая разметка сохраняется', () => {
    const clean = sanitizeRichText('<h3>Заголовок</h3><ul><li>Пункт</li></ul><strong>жирный</strong>');
    assert.ok(clean.includes('<h3>') && clean.includes('<li>') && clean.includes('<strong>'));
  });
});

describe('Разбор ссылок на видео', () => {
  test('распознаются основные формы ссылок YouTube', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    ]) {
      const parsed = parseVideoUrl(url);
      assert.equal(parsed?.videoId, 'dQw4w9WgXcQ', url);
      assert.equal(parsed?.embedUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
    }
  });

  test('таймкод переносится в embed-ссылку', () => {
    const parsed = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s');
    assert.equal(parsed?.startSeconds, 65);
    assert.ok(parsed?.embedUrl.endsWith('?start=65'));
  });

  test('подделка идентификатора отклоняется', () => {
    assert.equal(parseVideoUrl('https://www.youtube.com/embed/../../evil'), null);
    assert.equal(parseVideoUrl('https://evil.tld/watch?v=dQw4w9WgXcQ'), null);
  });

  test('распознаётся ссылка Zoom', () => {
    assert.equal(parseZoomUrl('https://us02web.zoom.us/j/123456789')?.meetingId, '123456789');
    assert.equal(parseZoomUrl('https://zoom.evil.tld/j/123456789'), null);
  });
});

describe('Вспомогательные правила', () => {
  test('логин подбирается без совпадений', () => {
    assert.equal(suggestLogin('Петров Алексей Иванович', []), 'petrov.a');
    assert.equal(suggestLogin('Петров Алексей Иванович', ['petrov.a']), 'petrov.a2');
  });

  test('просроченный срок распознаётся', () => {
    const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    assert.equal(dueStatus(past).level, 'overdue');
  });
});
