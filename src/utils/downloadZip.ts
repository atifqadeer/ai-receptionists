import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { pythonFiles } from './pythonFiles';

export async function downloadPythonBackend() {
  const zip = new JSZip();
  const folder = zip.folder('ai-receptionist-python-backend');
  
  if (!folder) {
    throw new Error('Failed to create zip folder');
  }

  // Add all Python files to the zip
  for (const [filename, content] of Object.entries(pythonFiles)) {
    folder.file(filename, content);
  }

  // Add a README for the zip
  folder.file('README.txt', `
🤖 AI Receptionist & Automation Hub - Python Backend
=====================================================

QUICK START:
1. Extract this zip file
2. cd ai-receptionist-python-backend
3. Install Python 3.9+ if not already installed
4. Create virtual environment: python -m venv venv
5. Activate virtual environment:
   - Windows: venv\\Scripts\\activate
   - macOS/Linux: source venv/bin/activate
6. Install dependencies: pip install -r requirements.txt
7. Copy .env.example to .env: cp .env.example .env
8. Edit .env and add your OPENAI_API_KEY
9. Start the server: python main.py
10. Open http://localhost:8000/docs in your browser

For detailed instructions, see QUICKSTART.md and README.md

Need help? Check the test_setup.py script to verify your installation.
  `);

  // Generate the zip file
  const blob = await zip.generateAsync({ type: 'blob' });
  
  // Download the zip file
  saveAs(blob, 'ai-receptionist-python-backend.zip');
}
