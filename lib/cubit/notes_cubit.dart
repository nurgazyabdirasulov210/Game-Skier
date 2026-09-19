import 'package:flutter_bloc/flutter_bloc.dart';
import '../data/notes_repository.dart';
import '../models/note.dart';
import 'notes_state.dart';

class NotesCubit extends Cubit<NotesState> {
  final NotesRepository repository;

  NotesCubit(this.repository) : super(const NotesInitial());

  Future<void> loadNotes() async {
    emit(const NotesLoading());
    try {
      final notes = await repository.getNotes();
      emit(NotesLoaded(notes));
    } catch (e) {
      emit(const NotesError('Не удалось загрузить заметки'));
    }
  }

  Future<void> addNote(String title, String text) async {
    try {
      final note = Note(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        title: title,
        text: text,
      );
      await repository.addNote(note);
      final notes = await repository.getNotes();
      emit(NotesLoaded(notes));
    } catch (e) {
      emit(const NotesError('Не удалось добавить заметку'));
    }
  }

  Future<void> updateNote(Note note) async {
    try {
      await repository.updateNote(note);
      final notes = await repository.getNotes();
      emit(NotesLoaded(notes));
    } catch (e) {
      emit(const NotesError('Не удалось изменить заметку'));
    }
  }

  Future<void> deleteNote(String id) async {
    try {
      await repository.deleteNote(id);
      final notes = await repository.getNotes();
      emit(NotesLoaded(notes));
    } catch (e) {
      emit(const NotesError('Не удалось удалить заметку'));
    }
  }
}
