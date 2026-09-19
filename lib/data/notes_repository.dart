import '../models/note.dart';
import 'local_data_source.dart';

class NotesRepository {
  final LocalDataSource localDataSource;

  NotesRepository(this.localDataSource);

  Future<List<Note>> getNotes() async {
    return await localDataSource.getNotes();
  }

  Future<void> addNote(Note note) async {
    final notes = await localDataSource.getNotes();
    notes.insert(0, note);
    await localDataSource.saveNotes(notes);
  }

  Future<void> updateNote(Note note) async {
    final notes = await localDataSource.getNotes();
    final index = notes.indexWhere((e) => e.id == note.id);
    if (index != -1) {
      notes[index] = note;
      await localDataSource.saveNotes(notes);
    }
  }

  Future<void> deleteNote(String id) async {
    final notes = await localDataSource.getNotes();
    notes.removeWhere((e) => e.id == id);
    await localDataSource.saveNotes(notes);
  }
}
