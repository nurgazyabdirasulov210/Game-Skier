import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'note.dart';
import 'edit_page.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  List<Note> notes = [];

  @override
  void initState() {
    super.initState();
    loadNotes();
  }

  Future<void> loadNotes() async {
    final prefs = await SharedPreferences.getInstance();
    final data = prefs.getString('notes');
    if (data != null) {
      final list = jsonDecode(data) as List;
      setState(() {
        notes = list.map((e) => Note.fromMap(e)).toList();
      });
    }
  }

  Future<void> saveNotes() async {
    final prefs = await SharedPreferences.getInstance();
    final data = jsonEncode(notes.map((e) => e.toMap()).toList());
    await prefs.setString('notes', data);
  }

  void addNote() async {
    final Note? result = await Navigator.push<Note>(
      context,
      MaterialPageRoute(builder: (context) => const EditPage()),
    );
    if (result != null) {
      setState(() {
        notes.insert(0, result);
      });
      saveNotes();
    }
  }

  void editNote(int index) async {
    final Note? result = await Navigator.push<Note>(
      context,
      MaterialPageRoute(builder: (context) => EditPage(note: notes[index])),
    );
    if (result != null) {
      setState(() {
        notes[index] = result;
      });
      saveNotes();
    }
  }

  void deleteNote(int index) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Удалить заметку?'),
          content: const Text('Это действие нельзя отменить'),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(context);
              },
              child: const Text('Отмена'),
            ),
            TextButton(
              onPressed: () {
                setState(() {
                  notes.removeAt(index);
                });
                saveNotes();
                Navigator.pop(context);
              },
              child: const Text('Удалить'),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Заметки'),
      ),
      body: notes.isEmpty
          ? const Center(child: Text('Заметок пока нет'))
          : ListView.builder(
              padding: const EdgeInsets.all(8),
              itemCount: notes.length,
              itemBuilder: (context, index) {
                final note = notes[index];
                return Card(
                  child: ListTile(
                    title: Text(
                      note.title.isEmpty ? 'Без названия' : note.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      note.text,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    onTap: () {
                      editNote(index);
                    },
                    trailing: IconButton(
                      icon: const Icon(Icons.delete),
                      onPressed: () {
                        deleteNote(index);
                      },
                    ),
                  ),
                );
              },
            ),
      floatingActionButton: FloatingActionButton(
        onPressed: addNote,
        child: const Icon(Icons.add),
      ),
    );
  }
}
