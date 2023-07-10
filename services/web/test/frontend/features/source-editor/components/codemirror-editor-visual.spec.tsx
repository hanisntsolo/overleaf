// Needed since eslint gets confused by mocha-each
/* eslint-disable mocha/prefer-arrow-callback */
import { FC } from 'react'
import { EditorProviders } from '../../../helpers/editor-providers'
import CodemirrorEditor from '../../../../../frontend/js/features/source-editor/components/codemirror-editor'
import { mockScope } from '../helpers/mock-scope'
import forEach from 'mocha-each'

const Container: FC = ({ children }) => (
  <div style={{ width: 785, height: 785 }}>{children}</div>
)

describe('<CodeMirrorEditor/> in Visual mode', function () {
  beforeEach(function () {
    window.metaAttributesCache.set('ol-preventCompileOnLoad', true)
    window.metaAttributesCache.set(
      'ol-mathJax3Path',
      'https://unpkg.com/mathjax@3.2.2/es5/tex-svg-full.js'
    )
    cy.interceptEvents()
    cy.interceptSpelling()

    // 3 blank lines
    const content = '\n'.repeat(3)

    const scope = mockScope(content)
    scope.editor.showVisual = true

    cy.mount(
      <Container>
        <EditorProviders scope={scope}>
          <CodemirrorEditor />
        </EditorProviders>
      </Container>
    )

    // wait for the content to be parsed and revealed
    cy.get('.cm-content').should('have.css', 'opacity', '1')

    cy.get('.cm-line').eq(0).as('first-line')
    cy.get('.cm-line').eq(1).as('second-line')
    cy.get('.cm-line').eq(2).as('third-line')
    cy.get('.cm-line').eq(3).as('fourth-line')
    cy.get('.ol-cm-toolbar [aria-label="Format Bold"]').as('toolbar-bold')

    cy.get('@first-line').click()
  })

  afterEach(function () {
    window.metaAttributesCache.clear()
  })

  forEach(['LaTeX', 'TeX']).it('renders the %s logo', function (logo) {
    cy.get('@first-line').type(`\\${logo}{{}}{Enter}`)
    cy.get('@first-line').should('have.text', logo)
  })

  it('renders \\dots', function () {
    cy.get('@first-line').type('\\dots{Esc}')
    cy.get('@first-line').should('have.text', '\\dots')
    cy.get('@first-line').type('{Enter}')
    cy.get('@first-line').should('have.text', '…')
  })

  it('creates a new list item on Enter', function () {
    cy.get('@first-line').type('\\begin{{}itemize')

    // select the first autocomplete item
    cy.findByRole('option').eq(0).click()

    cy.get('@first-line')
      .should('have.text', ' ')
      .find('.ol-cm-item')
      .should('have.length', 1)

    cy.get('@first-line').type('test{Enter}test')

    cy.get('@first-line')
      .should('have.text', ' test')
      .find('.ol-cm-item')
      .should('have.length', 1)
    cy.get('@second-line')
      .should('have.text', ' test')
      .find('.ol-cm-item')
      .should('have.length', 1)
  })

  it('finishes a list on Enter in the last item if empty', function () {
    cy.get('@first-line').type('\\begin{{}itemize')

    // select the first autocomplete item
    cy.findByRole('option').eq(0).click()

    cy.get('@first-line').type('test{Enter}{Enter}')

    cy.get('@first-line')
      .should('have.text', ' test')
      .find('.ol-cm-item')
      .should('have.length', 1)

    cy.get('.cm-line').eq(1).should('have.text', '')
  })

  it('does not finish a list on Enter in an earlier item if empty', function () {
    cy.get('@first-line').type('\\begin{{}itemize')

    // select the first autocomplete item
    cy.findByRole('option').eq(0).click()

    cy.get('@second-line').type('test{Enter}test{Enter}{upArrow}{Enter}{Enter}')
    cy.get('.cm-content').should('have.text', ' testtest')
  })

  forEach(['textbf', 'textit', 'underline']).it(
    'handles \\%s text',
    function (command) {
      cy.get('@first-line').type(`\\${command}{`)
      cy.get('@first-line').should('have.text', `{}`)
      cy.get('@first-line').type('{rightArrow} ')
      cy.get('@first-line').should('have.text', '{} ')
      cy.get('@first-line').type('{Backspace}{leftArrow}test text')
      cy.get('@first-line').should('have.text', '{test text}')
      cy.get('@first-line').type('{rightArrow} foo')
      cy.get('@first-line').should('have.text', 'test text foo') // no braces
      cy.get('@first-line').find(`.ol-cm-command-${command}`)
    }
  )

  forEach([
    'part',
    'chapter',
    'section',
    'subsection',
    'subsubsection',
    'paragraph',
    'subparagraph',
  ]).it('handles \\%s sectioning command', function (command) {
    cy.get('@first-line').type(`\\${command}{`)
    cy.get('@first-line').should('have.text', `\\${command}{}`)
    cy.get('@first-line').type('{rightArrow} ')
    cy.get('@first-line').should('have.text', `\\${command}{} `)
    // Type a section heading
    cy.get('@first-line').type('{Backspace}{leftArrow}title')
    cy.get('@first-line').should('have.text', '{title}') // braces are visible as cursor is adjacent
    cy.get('@first-line').type('{leftArrow}')
    cy.get('@first-line').should('have.text', 'title') // braces are hidden as cursor is not adjacent
    cy.get('@first-line').type('{Enter}')
    cy.get('@first-line').should('have.text', 'title') // braces are hidden as cursor is on the next line
    cy.get('@first-line').find(`.ol-cm-heading.ol-cm-command-${command}`)
  })

  forEach(['textsc', 'texttt', 'sout', 'emph', 'url', 'caption']).it(
    'handles \\%s text',
    function (command) {
      cy.get('@first-line').type(`\\${command}{`)
      cy.get('@first-line').should('have.text', `\\${command}{}`)
      cy.get('@first-line').type('{rightArrow} ')
      cy.get('@first-line').should('have.text', `\\${command}{} `)
      cy.get('@first-line').type('{Backspace}{leftArrow}test text{rightArrow} ')
      cy.get('@first-line').should('have.text', 'test text ')
      cy.get('@first-line').find(`.ol-cm-command-${command}`)
    }
  )

  it('handles \\verb text', function () {
    cy.get('@first-line').type(`\\verb|`)
    cy.get('@first-line').should('have.text', `\\verb|`)
    cy.get('@first-line').type('| ')
    cy.get('@first-line').should('have.text', `\\verb|| `)
    cy.get('@first-line').type('{Backspace}{leftArrow}test text{rightArrow} ')
    cy.get('@first-line').should('have.text', 'test text ')
    cy.get('@first-line').find(`.ol-cm-command-verb`)
  })

  forEach([
    ['ref', '🏷'],
    ['label', '🏷'],
    ['cite', '📚'],
    ['include', '🔗'],
  ]).it('handles \\%s commands', function (command, icon) {
    cy.get('@first-line').type(`\\${command}{} `)
    cy.get('@first-line').should('have.text', `\\${command}{} `)
    cy.get('@first-line').type('{Backspace}{leftArrow}key')
    cy.get('@first-line').should('have.text', `\\${command}{key}`)
    cy.get('@first-line').type('{rightArrow}')
    cy.get('@first-line').should('have.text', `\\${command}{key}`)
    cy.get('@first-line').type(' ')
    cy.get('@first-line').should('have.text', `${icon}key `)
  })

  it('handles \\href command', function () {
    cy.get('@first-line').type('\\href{{}https://overleaf.com} ')
    cy.get('@first-line').should('have.text', '\\href{https://overleaf.com} ')
    cy.get('@first-line').type('{Backspace}{{}{Del}Overleaf ')
    cy.get('@first-line').should(
      'have.text',
      '\\href{https://overleaf.com}{Overleaf '
    )
    cy.get('@first-line').type('{Backspace}} ')
    cy.get('@first-line').should('have.text', 'Overleaf ')
    cy.get('@first-line').find('.ol-cm-link-text')
  })

  it('displays unknown commands unchanged', function () {
    cy.get('@first-line').type('\\foo[bar]{{}baz} ')
    cy.get('@first-line').should('have.text', '\\foo[bar]{baz} ')
  })

  describe('Figure environments', function () {
    beforeEach(function () {
      cy.get('@first-line').type('\\begin{{}figure')
      cy.get('@first-line').type('{Enter}') // end with cursor in file path
    })

    it('loads figures', function () {
      cy.get('@third-line').type('path/to/image')

      cy.get('@third-line').should(
        'have.text',
        '    \\includegraphics{path/to/image}'
      )

      // move the cursor out of the figure
      cy.get('@third-line').type('{DownArrow}{DownArrow}{DownArrow}{DownArrow}')

      // Should be removed from dom when line is hidden
      cy.get('.cm-content').should(
        'not.contain',
        '\\includegraphics{path/to/image}'
      )

      cy.get('img.ol-cm-graphics').should('have.attr', 'src', 'path/to/image')
    })

    it('marks lines as figure environments', function () {
      // inside the figure
      cy.get('@second-line').should('have.class', 'ol-cm-environment-figure')
      // outside the figure
      cy.get('.cm-line')
        .eq(6)
        .should('not.have.class', 'ol-cm-environment-figure')
    })

    it('marks environment has centered when it has \\centering command', function () {
      // inside the figure
      cy.get('@third-line').should('have.class', 'ol-cm-environment-centered')
      // outside the figure
      cy.get('.cm-line')
        .eq(6)
        .should('not.have.class', 'ol-cm-environment-centered')
      // the line containing \centering
      cy.get('@second-line')
        .should('have.text', '    \\centering')
        .should('have.class', 'ol-cm-environment-centered')
      cy.get('@second-line').type('{Backspace}')
      cy.get('@second-line')
        .should('have.text', '    \\centerin')
        .should('not.have.class', 'ol-cm-environment-centered')
    })
  })
  describe('Toolbar', function () {
    describe('Formatting buttons highlighting', function () {
      it('handles empty selections inside of bold', function () {
        cy.get('@first-line').type('\\textbf{{}test}{LeftArrow}') // \textbf{test|}
        cy.get('@toolbar-bold').should('have.class', 'active')
        cy.get('@first-line').type('{LeftArrow}') // \textbf{tes|t}
        cy.get('@toolbar-bold').should('have.class', 'active')
        cy.get('@first-line').type('{LeftArrow}'.repeat(3)) // \textbf{|test}
        cy.get('@toolbar-bold').should('have.class', 'active')
      })

      it('handles empty selections outside bold', function () {
        cy.get('@first-line').type('\\textbf{{}test}')
        cy.get('@toolbar-bold').should('not.have.class', 'active')
        cy.get('@first-line').type('{LeftArrow}'.repeat(6))
        cy.get('@toolbar-bold').should('not.have.class', 'active')
      })

      it('handles range selections inside bold', function () {
        cy.get('@first-line').type('\\textbf{{}test}')
        cy.get('@first-line').type('{LeftArrow}'.repeat(4))
        cy.get('@first-line').type('{Shift}{RightArrow}{RightArrow}')
        cy.get('@toolbar-bold').should('have.class', 'active')
      })

      it('handles range selections spanning bold', function () {
        cy.get('@first-line').type('\\textbf{{}test} outside')
        cy.get('@first-line').type('{LeftArrow}'.repeat(10))
        cy.get('@first-line').type('{Shift}' + '{RightArrow}'.repeat(5))
        cy.get('@toolbar-bold').should('not.have.class', 'active')
      })

      it('does not highlight bold when commands at selection ends are different', function () {
        cy.get('@first-line').type('\\textbf{{}first} \\textbf{{}second}')
        cy.get('@first-line').type('{LeftArrow}'.repeat(12))
        cy.get('@first-line').type('{Shift}' + '{RightArrow}'.repeat(7))
        cy.get('@toolbar-bold').should('not.have.class', 'active')
      })

      it('highlight when ends share common formatting ancestor', function () {
        cy.get('@first-line').type(
          '\\textbf{{}\\textit{{}first} \\textit{{}second}}'
        )
        cy.get('@first-line').type('{LeftArrow}'.repeat(13))
        cy.get('@first-line').type('{Shift}' + '{RightArrow}'.repeat(7))
        cy.get('@toolbar-bold').should('have.class', 'active')
      })
    })
  })

  describe('Beamer frames', function () {
    it('hides markup', function () {
      cy.get('@first-line').type(
        '\\begin{{}frame}{{}Slide\\\\title}{Enter}\\end{{}frame}{Enter}'
      )
      cy.get('.ol-cm-divider')
      cy.get('.ol-cm-frame-title')
    })
    it('typesets title', function () {
      cy.get('@first-line').type(
        '\\begin{{}frame}{{}Slide\\\\title}{Enter}\\end{{}frame}{Enter}'
      )
      cy.get('.ol-cm-frame-title').should('have.html', 'Slide<br>title')
    })

    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('typesets math in title', function () {
      cy.get('@first-line').type(
        '\\begin{{}frame}{{}Slide $\\pi$}{Enter}\\end{{}frame}{Enter}'
      )

      // allow plenty of time for MathJax to load
      cy.get('.MathJax', { timeout: 10000 })
    })

    it('typesets subtitle', function () {
      cy.get('@first-line').type(
        '\\begin{{}frame}{{}Slide title}{{}Slide subtitle}{Enter}\\end{{}frame}{Enter}'
      )
      cy.get('.ol-cm-frame-subtitle').should('have.html', 'Slide subtitle')
    })
  })

  it('typesets \\maketitle', function () {
    cy.get('@first-line').type(
      [
        '\\author{{}Author}',
        '\\title{{}Document title\\\\with $\\pi$}',
        '\\begin{{}document}',
        '\\maketitle',
        '\\end{{}document}',
        '',
      ].join('{Enter}')
    )

    // allow plenty of time for MathJax to load
    // TODO: re-enable this assertion when stable
    // cy.get('.MathJax', { timeout: 10000 })

    cy.get('.ol-cm-maketitle')
    cy.get('.ol-cm-title').should('contain.html', 'Document title<br>with')
    cy.get('.ol-cm-author').should('have.text', 'Author')
  })

  it('decorates footnotes', function () {
    cy.get('@first-line').type('Foo \\footnote{{}Bar.} ')
    cy.get('@first-line').should('contain', 'Foo')
    cy.get('@first-line').should('not.contain', 'Bar')
    cy.get('@first-line').type('{leftArrow}')
    cy.get('@first-line').should('have.text', 'Foo \\footnote{Bar.} ')
  })

  it('should show document preamble', function () {
    cy.get('@first-line').type(
      [
        '\\author{{}Author}',
        '\\title{{}Document title}',
        '\\begin{{}document}',
        '\\maketitle',
        '\\end{{}document}',
        '',
      ].join('{Enter}')
    )
    cy.get('.ol-cm-preamble-widget').should('have.length', 1)
    cy.get('.ol-cm-preamble-widget').click()

    cy.get('.ol-cm-preamble-line').eq(0).should('contain', '\\author{Author}')
    cy.get('.ol-cm-preamble-line')
      .eq(1)
      .should('contain', '\\title{Document title}')
    cy.get('.ol-cm-preamble-line').eq(2).should('contain', '\\begin{document}')
    cy.get('.ol-cm-preamble-line').eq(3).should('not.exist')
  })

  it('should show multiple authors', function () {
    cy.get('@first-line').type(
      [
        '\\author{{}Author \\and Author2}',
        '\\author{{}Author3}',
        '\\title{{}Document title}',
        '\\begin{{}document}',
        '\\maketitle',
        '\\end{{}document}',
        '',
      ].join('{Enter}')
    )
    cy.get('.ol-cm-preamble-widget').should('have.length', 1)
    cy.get('.ol-cm-preamble-widget').click()

    cy.get('.ol-cm-authors').should('have.length', 1)
    cy.get('.ol-cm-authors .ol-cm-author').should('have.length', 3)
  })

  it('should update authors', function () {
    cy.get('@first-line').type(
      [
        '\\author{{}Author \\and Author2}',
        '\\author{{}Author3}',
        '\\title{{}Document title}',
        '\\begin{{}document}',
        '\\maketitle',
        '\\end{{}document}',
        '',
      ].join('{Enter}')
    )
    cy.get('.ol-cm-preamble-widget').should('have.length', 1)
    cy.get('.ol-cm-preamble-widget').click()

    cy.get('.ol-cm-authors').should('have.length', 1)
    cy.get('.ol-cm-author').eq(0).should('contain', 'Author')
    cy.get('.ol-cm-author').eq(1).should('contain', 'Author2')
    cy.get('.ol-cm-author').eq(2).should('contain', 'Author3')

    cy.get('.ol-cm-author').eq(0).click()
    cy.get('.ol-cm-preamble-line').eq(0).type('{leftarrow}{backspace}New')
    cy.get('.ol-cm-author').eq(1).should('contain', 'AuthorNew')

    // update author without changing node from/to coordinates
    cy.get('.ol-cm-author').eq(0).click()
    cy.get('.ol-cm-preamble-line').eq(0).type('{leftarrow}{shift}{leftarrow}X')
    cy.get('.ol-cm-author').eq(1).should('contain', 'AuthorNeX')
  })

  // TODO: \input
  // TODO: Math
  // TODO: Abstract
})
