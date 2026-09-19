import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../cubit/notes_cubit.dart';
import '../models/note.dart';

@RoutePage()
class EditNotePage extends StatefulWidget {
  final Note? note;

  const EditNotePage({super.key, this.note});

  @override
  State<EditNotePage> createState() => _EditNotePageState();
}

class _EditNotePageState extends State<EditNotePage> {
  late TextEditingController titleController;
  late TextEditingController textController;
  late NotesCubit notesCubit;

  bool get isEditing => widget.note != null;

  @override
  void initState() {
    super.initState();
    titleController = TextEditingController(text: widget.note?.title ?? '');
    textController = TextEditingController(text: widget.note?.text ?? '');
    debugPrint('EditNotePage initState');
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    notesCubit = context.read<NotesCubit>();
    debugPrint('EditNotePage didChangeDependencies');
  }

  @override
  void deactivate() {
    debugPrint('EditNotePage deactivate');
    super.deactivate();
  }

  @override
  void dispose() {
    titleController.dispose();
    textController.dispose();
    debugPrint('EditNotePage dispose');
    super.dispose();
  }

  Future<void> save() async {
    final title = titleController.text.trim();
    final text = textController.text.trim();
    final messenger = ScaffoldMessenger.of(context);
    final router = context.router;

    if (title.isEmpty && text.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Заметка пустая')),
      );
      return;
    }

    if (isEditing) {
      await notesCubit.updateNote(widget.note!.copyWith(title: title, text: text));
      messenger.showSnackBar(
        const SnackBar(content: Text('Заметка изменена')),
      );
    } else {
      await notesCubit.addNote(title, text);
      messenger.showSnackBar(
        const SnackBar(content: Text('Заметка добавлена')),
      );
    }

    router.maybePop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(isEditing ? 'Редактирование' : 'Новая заметка'),
        actions: [
          IconButton(
            onPressed: save,
            icon: const Icon(Icons.check),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 700),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                TextField(
                  controller: titleController,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                  decoration: const InputDecoration(
                    hintText: 'Заголовок',
                    border: InputBorder.none,
                  ),
                ),
                Expanded(
                  child: TextField(
                    controller: textController,
                    maxLines: null,
                    expands: true,
                    textAlignVertical: TextAlignVertical.top,
                    decoration: const InputDecoration(
                      hintText: 'Текст заметки',
                      border: InputBorder.none,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
