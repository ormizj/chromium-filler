import { describe, it, expect, beforeEach } from 'vitest';
import { fingerprint, inputKind, phraseIn, questionText, sectionText } from './questionText';

function mount(html: string): void {
  document.body.innerHTML = html;
}
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

beforeEach(() => mount(''));

describe('questionText', () => {
  it('reads a <label for>', () => {
    mount('<label for="a">Given name</label><input id="a">');
    expect(questionText($('#a'))).toBe('Given name');
  });

  it('reads a wrapping label without the text of the control inside it', () => {
    mount('<label>Country <select id="c"><option>Spain</option><option>France</option></select></label>');
    expect(questionText($('#c'))).toBe('Country');
  });

  it('reads aria-labelledby, then aria-label', () => {
    mount('<span id="q">Years of experience</span><input id="a" aria-labelledby="q"><input id="b" aria-label="Salary">');
    expect(questionText($('#a'))).toBe('Years of experience');
    expect(questionText($('#b'))).toBe('Salary');
  });

  it('reads the question written above the box when nothing labels it', () => {
    mount(`
      <div class="field">
        <div class="q">How did you hear about us?</div>
        <div><input id="a"></div>
      </div>`);
    expect(questionText($('#a'))).toBe('How did you hear about us?');
  });

  it('does not take the text of a previous field as the question', () => {
    mount(`
      <div><label for="x">Email</label><input id="x"></div>
      <div><input id="a"></div>`);
    expect(questionText($('#a'))).toBe('');
  });

  it('asks a radio group its legend, not the option label', () => {
    mount(`
      <fieldset><legend>Do you need visa sponsorship?</legend>
        <label><input type="radio" name="v" id="y" value="yes"> Yes</label>
        <label><input type="radio" name="v" id="n" value="no"> No</label>
      </fieldset>`);
    expect(questionText($('#y'))).toBe('Do you need visa sponsorship?');
  });

  it('falls back to the placeholder, then the title', () => {
    mount('<input id="a" placeholder="Portfolio URL"><input id="b" title="Notice period">');
    expect(questionText($('#a'))).toBe('Portfolio URL');
    expect(questionText($('#b'))).toBe('Notice period');
  });

  it('collapses whitespace', () => {
    mount('<label for="a">  First\n   name  *</label><input id="a">');
    expect(questionText($('#a'))).toBe('First name *');
  });
});

describe('fingerprint', () => {
  it('drops required marks, punctuation and filler', () => {
    expect(fingerprint('First name *')).toBe('first name');
    expect(fingerprint('Please enter your email address:')).toBe('email address');
    expect(fingerprint('What is your notice period? (optional)')).toBe('notice period');
    expect(fingerprint('Phone (required)')).toBe('phone');
  });

  it('strips diacritics, as normalizeAttr does', () => {
    expect(fingerprint('Résumé')).toBe('resume');
  });

  it('keeps the words that make two questions different', () => {
    expect(fingerprint('Reference name')).not.toBe(fingerprint('Name'));
  });
});

describe('phraseIn', () => {
  it('matches a whole phrase inside a longer question', () => {
    expect(phraseIn('how many years of experience do you have', 'years of experience')).toBe(true);
  });
  it('never matches inside a word', () => {
    expect(phraseIn('category', 'cat')).toBe(false);
  });
  it('an empty phrase matches nothing', () => {
    expect(phraseIn('anything', '')).toBe(false);
  });
});

describe('inputKind', () => {
  it('names each control', () => {
    mount(`
      <input id="t"><input id="e" type="email"><input id="p" type="tel"><input id="d" type="date">
      <textarea id="ta"></textarea><select id="s"></select>
      <input id="r" type="radio"><input id="c" type="checkbox"><input id="f" type="file">
      <div id="ed" contenteditable="true"></div>`);
    expect(inputKind($('#t'))).toBe('text');
    expect(inputKind($('#e'))).toBe('email');
    expect(inputKind($('#p'))).toBe('tel');
    expect(inputKind($('#d'))).toBe('date');
    expect(inputKind($('#ta'))).toBe('textarea');
    expect(inputKind($('#s'))).toBe('select');
    expect(inputKind($('#r'))).toBe('radio');
    expect(inputKind($('#c'))).toBe('checkbox');
    expect(inputKind($('#f'))).toBe('file');
    expect(inputKind($('#ed'))).toBe('editable');
  });

  it('refuses the controls that are never ours to fill', () => {
    mount(`
      <input id="pw" type="password"><input id="h" type="hidden"><input id="sr" type="search">
      <input id="sb" type="submit"><select id="m" multiple></select><div id="x"></div>`);
    for (const id of ['pw', 'h', 'sr', 'sb', 'm', 'x']) expect(inputKind($(`#${id}`))).toBeNull();
  });
});

describe('sectionText', () => {
  it('names the fieldset an input sits in', () => {
    mount(`
      <fieldset><legend>Reference 1</legend><label for="a">Name</label><input id="a"></fieldset>
      <fieldset><legend>Reference 2</legend><label for="b">Name</label><input id="b"></fieldset>`);
    expect(sectionText($('#a'))).toBe('reference 1');
    expect(sectionText($('#b'))).toBe('reference 2');
  });

  it('falls back to the nearest heading above the input', () => {
    mount(`
      <form><h3>About you</h3><input id="a"><h3>Emergency contact</h3><input id="b"></form>`);
    expect(sectionText($('#a'))).toBe('about you');
    expect(sectionText($('#b'))).toBe('emergency contact');
  });

  it('a radio group skips the legend it uses as its question', () => {
    mount(`
      <h2>Eligibility</h2>
      <fieldset><legend>Need sponsorship?</legend><input type="radio" name="s" id="r"></fieldset>`);
    expect(sectionText($('#r'))).toBe('eligibility');
  });
});
